import { mkdtemp, cp, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

// A fresh checkout must deploy without a prior dist/ or .wrangler/ redirect.
// Use dry-run only: this check never publishes or requests chess-results.
const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(tmpdir(), "valters-deploy-"));
try {
  for (const name of ["src", "public", "package.json", "vite.config.ts", "tsconfig.json", "wrangler.jsonc"]) {
    await cp(join(root, name), join(directory, name), { recursive: true });
  }
  await symlink(join(root, "node_modules"), join(directory, "node_modules"), "dir");
  const result = spawnSync(process.execPath, [join(root, "node_modules/wrangler/bin/wrangler.js"), "deploy", "--config", "wrangler.jsonc", "--dry-run"], {
    cwd: directory, stdio: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Clean-checkout deploy failed (${result.status}).`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
