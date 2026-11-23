import { test } from "node:test";
import assert from "node:assert/strict";

test("only the page and the framework's own data calls are edge-cached", async () => {
  const { edgeCacheKey } = await import("../src/lib/edge-cache");
  const get = (path: string, headers: Record<string, string> = {}) => new Request(`https://saha.kalns.eu${path}`, { headers });
  assert.equal(edgeCacheKey(get("/?utm=x&r=123")), "https://saha.kalns.eu/");
  assert.equal(edgeCacheKey(get("/_serverFn/abc?payload=1", { "x-tsr-serverFn": "true" })), "https://saha.kalns.eu/_serverFn/abc?payload=1");
  assert.equal(edgeCacheKey(get("/_serverFn/abc")), null);
  assert.equal(edgeCacheKey(get("/nav")), null);
  assert.equal(edgeCacheKey(new Request("https://saha.kalns.eu/", { method: "POST" })), null);
});
