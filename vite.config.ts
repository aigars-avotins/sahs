import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(async () => ({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      ...(process.env.VITE_CLOUDFLARE === "1"
        ? {}
        : { "cloudflare:workers": fileURLToPath(new URL("./src/lib/chess/workers-stub.ts", import.meta.url)) }),
    },
  },
  // Wrangler deploys dist/server/index.js; Vite compiles the source entry below.
  plugins: [
    ...(process.env.VITE_CLOUDFLARE === "1" ? [(await import("@cloudflare/vite-plugin")).cloudflare({ config: { main: "src/worker.ts" }, viteEnvironment: { name: "ssr" } })] : []),
    tanstackStart(), viteReact(), tailwindcss(),
  ],
  server: { host: "127.0.0.1", port: 8080 },
}));
