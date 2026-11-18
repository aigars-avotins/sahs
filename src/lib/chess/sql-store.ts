import type { CacheState, StateStore } from "./coordinator.server";

/** The subset of Durable Object SQL storage this store uses (also satisfiable by node:sqlite in tests). */
export interface SqlLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches both SqlStorage and node:sqlite bindings
  exec(query: string, ...bindings: any[]): { toArray(): Record<string, unknown>[] };
}

/**
 * One row per cached source page instead of one JSON blob: a write touches only the
 * entries that changed, and no single row approaches the 2 MB SQLite value limit.
 */
export class SqlStateStore implements StateStore {
  /** `at` of each entry as last read or written, to skip unchanged rows. */
  private written = new Map<string, number>();

  constructor(private sql: SqlLike, private transaction: (run: () => void) => void = (run) => run()) {
    sql.exec("CREATE TABLE IF NOT EXISTS cache_meta (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS cache_entry (key TEXT PRIMARY KEY, at INTEGER NOT NULL, value TEXT NOT NULL)");
  }

  async read(): Promise<CacheState | undefined> {
    const legacy = await this.legacy();
    if (legacy) return legacy;
    const meta = this.sql.exec("SELECT body FROM cache_meta WHERE id = 1").toArray()[0];
    if (!meta) return undefined;
    const state = JSON.parse(String(meta.body)) as CacheState;
    state.entries = {};
    this.written.clear();
    for (const row of this.sql.exec("SELECT key, at, value FROM cache_entry").toArray()) {
      const key = String(row.key);
      state.entries[key] = { at: Number(row.at), value: JSON.parse(String(row.value)) };
      this.written.set(key, Number(row.at));
    }
    return state;
  }

  async write(state: CacheState): Promise<void> {
    const { entries, ...meta } = state;
    this.transaction(() => {
      this.sql.exec(
        "INSERT INTO cache_meta(id, body) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body",
        JSON.stringify(meta),
      );
      for (const [key, entry] of Object.entries(entries)) {
        if (this.written.get(key) === entry.at) continue;
        this.sql.exec(
          "INSERT INTO cache_entry(key, at, value) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, value = excluded.value",
          key,
          entry.at,
          JSON.stringify(entry.value),
        );
        this.written.set(key, entry.at);
      }
      for (const key of [...this.written.keys()]) {
        if (key in entries) continue;
        this.sql.exec("DELETE FROM cache_entry WHERE key = ?", key);
        this.written.delete(key);
      }
    });
  }

  /** Moves the pre-2.6 single-row layout (`cache_state`) into the new tables once. */
  private async legacy(): Promise<CacheState | undefined> {
    const table = this.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cache_state'").toArray()[0];
    if (!table) return undefined;
    const row = this.sql.exec("SELECT body FROM cache_state WHERE id = 1").toArray()[0];
    const state = row ? (JSON.parse(String(row.body)) as CacheState) : undefined;
    // Write the new layout first; the old table goes only after that succeeded.
    if (state) await this.write(state);
    this.sql.exec("DROP TABLE cache_state");
    return state;
  }
}
