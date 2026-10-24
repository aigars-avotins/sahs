import { mkdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SourceCoordinator, type CacheState, type SourceContext } from "./coordinator.server";
import type { LoadResult } from "./types";

const directory = process.env.VALTERS_CACHE_DIR || ".cache/valters";
const file = join(directory, "source-v2.json");
const lock = join(directory, "source.lock");
const store = {
  async read(): Promise<CacheState | undefined> {
    try { return JSON.parse(await readFile(file, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  },
  async write(state: CacheState) {
    await mkdir(directory, { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(state), { mode: 0o600 });
    await rename(temp, file);
    await utimes(lock, new Date(), new Date());
  },
};
let pending: Promise<LoadResult> | null = null;
/** Persistent volume required for Node hosting; lock coordinates multiple processes. */
export function loadWithFileCache(job: (context: SourceContext) => Promise<Extract<LoadResult, { ok: true }>>): Promise<LoadResult> {
  if (pending) return pending;
  pending = run(job).finally(() => { pending = null; });
  return pending;
}
async function run(job: (context: SourceContext) => Promise<Extract<LoadResult, { ok: true }>>): Promise<LoadResult> {
  await mkdir(directory, { recursive: true });
  for (let attempt = 0; attempt < 900; attempt++) {
    try { await mkdir(lock); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const held = await stat(lock).catch(() => null);
      if (held && Date.now() - held.mtimeMs > 10 * 60_000) { await rm(lock, { recursive: true, force: true }); continue; }
      const saved = await store.read();
      if (saved?.snapshot) return { ...saved.snapshot, dossier: { ...saved.snapshot.dossier, nextCheckAt: new Date(saved.nextAllowedAt).toISOString() } };
      if (attempt === 899) return { ok: false, error: "Pirmā datu ielāde vēl notiek. Mēģini vēlāk.", nextCheckAt: new Date(Date.now() + 300_000).toISOString() };
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  try { return await new SourceCoordinator(store).load(job); }
  finally { await rm(lock, { recursive: true, force: true }); }
}
