import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { resolve } from "node:path";

// Exercise the default native fetch inside workerd. Every outbound request is
// intercepted locally; this test never contacts chess-results.
const output = await build({
  stdin: {
    resolveDir: resolve(import.meta.dirname, ".."),
    loader: "ts",
    contents: `
      import { SourceCoordinator } from "./src/lib/chess/coordinator.server";
      let saved;
      const coordinator = new SourceCoordinator({read: async () => saved, write: async state => { saved = state; }});
      export default { async fetch() {
        const result = await coordinator.load(async source => {
          const response = await source.request("https://chess-results.com/binding-check");
          if (await response.text() !== "mock-source") throw new Error("Unexpected outbound response");
          return {ok: true, stale: false, warning: null, dossier: {today: "2026-10-25", tournaments: [], fetchedAt: new Date().toISOString()}};
        });
        return Response.json(result);
      }};
    `,
  },
  bundle: true, format: "esm", platform: "browser", target: "es2022", write: false,
});
let outbound = 0;
const runtime = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  script: output.outputFiles[0].text,
  compatibilityDate: "2026-10-24",
  outboundService: async request => {
    assert.equal(request.url, "https://chess-results.com/binding-check");
    outbound += 1;
    return new Response("mock-source");
  },
}));
try {
  const first = await (await runtime.dispatchFetch("http://localhost/check")).json();
  assert.equal(first.ok, true, first.error);
  const cached = await (await runtime.dispatchFetch("http://localhost/check")).json();
  assert.equal(cached.ok, true, cached.error);
  assert.equal(outbound, 1, "second visitor must use the shared cache");
  console.log("Workers runtime: native fetch binding and shared cache passed (mock source).");
} finally {
  await runtime.dispose();
}
