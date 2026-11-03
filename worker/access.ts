/** Verifies the Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`) with WebCrypto only. */

export interface AccessClaims {
  aud: string | string[];
  iss: string;
  exp: number;
  nbf?: number;
  email?: string;
}

export type KeyLookup = (kid: string) => Promise<CryptoKey | undefined>;

const ALGORITHM = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

function base64UrlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(part))) as T;
}

export async function verifyJwt(
  token: string,
  opts: { issuer: string; audience: string; keys: KeyLookup; now?: number },
): Promise<AccessClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [h, p, sig] = parts as [string, string, string];

  const header = decodeJson<{ alg?: string; kid?: string }>(h);
  if (header.alg !== "RS256" || !header.kid) throw new Error("unsupported token header");
  const key = await opts.keys(header.kid);
  if (!key) throw new Error("unknown signing key");

  const signed = new TextEncoder().encode(`${h}.${p}`);
  if (!(await crypto.subtle.verify(ALGORITHM, key, base64UrlDecode(sig), signed))) {
    throw new Error("bad signature");
  }

  const claims = decodeJson<AccessClaims>(p);
  const now = (opts.now ?? Date.now()) / 1000;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== opts.issuer) throw new Error("wrong issuer");
  if (!audiences.includes(opts.audience)) throw new Error("wrong audience");
  if (typeof claims.exp !== "number" || claims.exp <= now) throw new Error("expired");
  if (typeof claims.nbf === "number" && claims.nbf > now + 60) throw new Error("not yet valid");
  return claims;
}

const CERT_TTL_MS = 60 * 60 * 1000;
let cache: { url: string; keys: Map<string, CryptoKey>; fetchedAt: number } | null = null;

async function fetchKeys(url: string): Promise<Map<string, CryptoKey>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Access certs: ${res.status}`);
  const { keys } = (await res.json()) as { keys: (JsonWebKey & { kid?: string })[] };
  const map = new Map<string, CryptoKey>();
  for (const jwk of keys) {
    if (!jwk.kid) continue;
    map.set(jwk.kid, await crypto.subtle.importKey("jwk", jwk, ALGORITHM, false, ["verify"]));
  }
  return map;
}

/** Keys are cached per isolate and refetched once when an unknown `kid` appears (key rotation). */
export function accessKeys(teamDomain: string): KeyLookup {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  return async (kid) => {
    let current = cache;
    const fresh = current?.url === url && Date.now() - current.fetchedAt < CERT_TTL_MS;
    if (!current || !fresh || !current.keys.has(kid)) {
      current = cache = { url, keys: await fetchKeys(url), fetchedAt: Date.now() };
    }
    return current.keys.get(kid);
  };
}
