import { DurableObject } from "cloudflare:workers";
import { SourceCoordinator, type CacheState } from "./lib/chess/coordinator.server";
import { scrapeDossier } from "./lib/chess/scrape.server";

/** All Worker instances use this one named object, including after eviction. */
export class ChessCache extends DurableObject {
  private coordinator = new SourceCoordinator({
    read: async () => {
      const row = this.ctx.storage.sql.exec<{ body: string }>("SELECT body FROM cache_state WHERE id = 1").toArray()[0];
      return row ? JSON.parse(row.body) as CacheState : undefined;
    },
    write: async (state) => {
      // SQLite avoids the 128 KiB per-value limit of the key/value API.
      this.ctx.storage.sql.exec("INSERT INTO cache_state(id, body) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body", JSON.stringify(state));
    },
  });
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS cache_state (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
  }
  async fetch(): Promise<Response> {
    return Response.json(await this.coordinator.load(scrapeDossier), { headers: { "Cache-Control": "no-store" } });
  }
}
