import handler from "@tanstack/react-start/server-entry";
export { ChessCache } from "./chess-cache";

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

export default {
  async fetch(request: Request): Promise<Response> {
    const response = await handler.fetch(request);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) if (!headers.has(name)) headers.set(name, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
