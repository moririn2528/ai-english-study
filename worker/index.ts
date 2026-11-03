/**
 * Relays the browser's OpenAI calls so the API key never leaves Cloudflare.
 * Only `/api/*` reaches this code (`run_worker_first`); everything else is served as static assets.
 */
import { accessKeys, verifyJwt, type KeyLookup } from "./access";

export interface Env {
  /** Secret: `wrangler secret put OPENAI_API_KEY`. */
  OPENAI_API_KEY?: string;
  /** Secret: Access team domain, e.g. `myteam.cloudflareaccess.com`. */
  ACCESS_TEAM_DOMAIN?: string;
  /** Secret: Access application AUD tag (`terraform output access_aud`). */
  ACCESS_AUD?: string;
  /** Local `wrangler dev` only (`.dev.vars`); ignored on any non-loopback host. */
  ALLOW_UNAUTHENTICATED?: string;
}

const UPSTREAM = "https://api.openai.com/v1";
const PREFIX = "/api/openai";
/** Exactly the endpoints the app uses. */
const ROUTES = new Set([
  "/responses",
  "/audio/transcriptions",
  "/chat/completions",
  "/realtime/client_secrets",
  "/audio/speech",
]);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function fail(status: number, message: string): Response {
  return Response.json({ error: { message } }, { status, headers: { "Cache-Control": "no-store" } });
}

async function authenticated(req: Request, url: URL, env: Env, keys?: KeyLookup): Promise<boolean> {
  if (env.ALLOW_UNAUTHENTICATED === "true" && LOOPBACK.has(url.hostname)) return true;
  // Fail closed: without Access configuration nothing is relayed.
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return false;
  const token = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return false;
  try {
    await verifyJwt(token, {
      issuer: `https://${env.ACCESS_TEAM_DOMAIN}`,
      audience: env.ACCESS_AUD,
      keys: keys ?? accessKeys(env.ACCESS_TEAM_DOMAIN),
    });
    return true;
  } catch {
    return false;
  }
}

export async function handle(req: Request, env: Env, keys?: KeyLookup): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.startsWith(`${PREFIX}/`) ? url.pathname.slice(PREFIX.length) : "";
  if (!ROUTES.has(path)) return fail(404, "not found");
  if (req.method !== "POST") return fail(405, "method not allowed");
  // Browsers always send Origin on POST; a mismatch means another site is driving the request.
  if (req.headers.get("Origin") !== url.origin) return fail(403, "cross-origin request refused");
  if (!(await authenticated(req, url, env, keys))) {
    return fail(401, "ログインが確認できません。ページを再読み込みしてください");
  }
  if (!env.OPENAI_API_KEY) return fail(500, "サーバーに OPENAI_API_KEY が設定されていません");

  const headers = new Headers({ Authorization: `Bearer ${env.OPENAI_API_KEY}` });
  const type = req.headers.get("Content-Type");
  if (type) headers.set("Content-Type", type);
  const upstream = await fetch(`${UPSTREAM}${path}`, { method: "POST", headers, body: req.body });

  const out = new Headers({ "Cache-Control": "no-store" });
  const upstreamType = upstream.headers.get("Content-Type");
  if (upstreamType) out.set("Content-Type", upstreamType);
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export default {
  fetch: (req: Request, env: Env) => handle(req, env),
};
