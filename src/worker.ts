import handler from "@tanstack/react-start/server-entry";
export { ChessCache } from "./chess-cache";
import { EDGE_SECONDS, edgeCacheKey } from "./lib/edge-cache";

/**
 * Baseline security headers for the pages and server functions this Worker answers
 * (static files are served by Cloudflare before the Worker runs). No CSP yet: the
 * hydration and theme scripts are inline.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) if (!headers.has(name)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
    const key = edgeCacheKey(request);
    // Workers expose the zone cache as caches.default (not in the DOM CacheStorage type).
    const cache = key && typeof caches !== "undefined" ? (caches as unknown as { default: Cache }).default : null;
    if (cache && key) {
      const hit = await cache.match(key);
      if (hit) return hit;
    }
    const response = withSecurityHeaders(await handler.fetch(request));
    if (cache && key && response.status === 200 && !response.headers.has("Set-Cookie")) {
      const stored = new Response(response.clone().body, response);
      stored.headers.set("Cache-Control", `public, max-age=${EDGE_SECONDS}`);
      ctx.waitUntil(cache.put(key, stored));
    }
    return response;
  },
};
