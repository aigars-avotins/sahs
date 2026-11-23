/**
 * Every visitor gets the same page and data, so a short edge cache answers repeat loads
 * without waking the Durable Object. Kept well under the 1-minute refresh interval of a
 * running tournament, so the page is at most this much older than the cache server's data.
 */
export const EDGE_SECONDS = 20;

/** The cache key for a request, or null when it must not be cached. */
export function edgeCacheKey(request: Request): string | null {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  // Query strings on the page are ignored, so random ones cannot bypass the cache.
  if (url.pathname === "/") return `${url.origin}/`;
  // Data refreshes: only the framework's own calls (it rejects others), keyed by function and payload.
  if (url.pathname.startsWith("/_serverFn/") && request.headers.get("x-tsr-serverFn") === "true") return url.href;
  return null;
}
