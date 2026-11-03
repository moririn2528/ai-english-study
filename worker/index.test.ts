import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { verifyJwt, type KeyLookup } from "./access";
import { handle, type Env } from "./index";

const TEAM = "team.cloudflareaccess.com";
const AUD = "aud-tag";
const ORIGIN = "https://app.example.workers.dev";
const ENV: Env = { OPENAI_API_KEY: "sk-secret", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };

let signer: CryptoKeyPair;
let other: CryptoKeyPair;
const keys: KeyLookup = async (kid) => (kid === "k1" ? signer.publicKey : undefined);

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const part = (obj: unknown) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

async function token(claims: Record<string, unknown>, opts: { kid?: string; key?: CryptoKey } = {}) {
  const head = part({ alg: "RS256", kid: opts.kid ?? "k1" });
  const body = part({ iss: `https://${TEAM}`, aud: [AUD], exp: Date.now() / 1000 + 300, ...claims });
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    opts.key ?? signer.privateKey,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

function request(path: string, init: { jwt?: string; origin?: string; method?: string; host?: string } = {}) {
  const headers = new Headers({ "Content-Type": "application/json" });
  const origin = init.origin ?? (init.host ? `http://${init.host}` : ORIGIN);
  headers.set("Origin", origin);
  if (init.jwt) headers.set("Cf-Access-Jwt-Assertion", init.jwt);
  const base = init.host ? `http://${init.host}` : ORIGIN;
  return new Request(`${base}${path}`, { method: init.method ?? "POST", headers, body: init.method === "GET" ? null : "{}" });
}

beforeAll(async () => {
  const params = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
  signer = (await crypto.subtle.generateKey(params, false, ["sign", "verify"])) as CryptoKeyPair;
  other = (await crypto.subtle.generateKey(params, false, ["sign", "verify"])) as CryptoKeyPair;
});

afterEach(() => vi.unstubAllGlobals());

describe("verifyJwt", () => {
  const opts = { issuer: `https://${TEAM}`, audience: AUD, keys };

  it("accepts a valid token", async () => {
    await expect(verifyJwt(await token({ email: "a@b.c" }), opts)).resolves.toMatchObject({ email: "a@b.c" });
  });
  it("rejects a forged signature", async () => {
    await expect(verifyJwt(await token({}, { key: other.privateKey }), opts)).rejects.toThrow("bad signature");
  });
  it("rejects wrong audience, issuer, expiry and unknown keys", async () => {
    await expect(verifyJwt(await token({ aud: ["other"] }), opts)).rejects.toThrow("audience");
    await expect(verifyJwt(await token({ iss: "https://evil" }), opts)).rejects.toThrow("issuer");
    await expect(verifyJwt(await token({ exp: Date.now() / 1000 - 1 }), opts)).rejects.toThrow("expired");
    await expect(verifyJwt(await token({}, { kid: "nope" }), opts)).rejects.toThrow("unknown");
  });
});

describe("handle", () => {
  it("relays allowed calls with the server key and drops client credentials", async () => {
    const upstream = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ ok: true }, { headers: { "Set-Cookie": "x=1" } }),
    );
    vi.stubGlobal("fetch", upstream);
    const res = await handle(request("/api/openai/responses", { jwt: await token({}) }), ENV, keys);
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    const [url, init] = upstream.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    const sent = new Headers(init.headers);
    expect(sent.get("Authorization")).toBe("Bearer sk-secret");
    expect(sent.get("Cf-Access-Jwt-Assertion")).toBeNull();
  });

  it("refuses without a valid login", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect((await handle(request("/api/openai/responses"), ENV, keys)).status).toBe(401);
    const forged = await token({}, { key: other.privateKey });
    expect((await handle(request("/api/openai/responses", { jwt: forged }), ENV, keys)).status).toBe(401);
    const unconfigured = { OPENAI_API_KEY: "sk-secret" };
    expect((await handle(request("/api/openai/responses", { jwt: await token({}) }), unconfigured, keys)).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses other paths, methods and origins", async () => {
    const jwt = await token({});
    expect((await handle(request("/api/openai/files", { jwt }), ENV, keys)).status).toBe(404);
    expect((await handle(request("/api/openai/responses", { jwt, method: "GET" }), ENV, keys)).status).toBe(405);
    expect((await handle(request("/api/openai/responses", { jwt, origin: "https://evil.example" }), ENV, keys)).status).toBe(403);
  });

  it("honours the local bypass only on loopback hosts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    const dev = { OPENAI_API_KEY: "sk", ALLOW_UNAUTHENTICATED: "true" };
    expect((await handle(request("/api/openai/responses", { host: "127.0.0.1:8787" }), dev, keys)).status).toBe(200);
    expect((await handle(request("/api/openai/responses"), dev, keys)).status).toBe(401);
  });
});
