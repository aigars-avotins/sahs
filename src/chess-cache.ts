import { DurableObject } from "cloudflare:workers";
import { MINUTE, SourceCoordinator } from "./lib/chess/coordinator.server";
import { scrapeDossier } from "./lib/chess/scrape.server";
import { SqlStateStore } from "./lib/chess/sql-store";

/** How long a visitor waits for a due refresh before getting the last good data. */
const QUICK_WAIT = 10_000;

/** All Worker instances use this one named object, including after eviction. */
export class ChessCache extends DurableObject {
  private coordinator: SourceCoordinator;
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.coordinator = new SourceCoordinator(new SqlStateStore(ctx.storage.sql, (run) => ctx.storage.transactionSync(run)));
  }
  async fetch(): Promise<Response> {
    const result = await this.coordinator.load(scrapeDossier, QUICK_WAIT);
    // Visits only start refreshes (no polling without visitors). If one is still running,
    // the alarm finishes it even if this object is evicted first; the shared guard still applies.
    if (this.coordinator.busy) await this.ctx.storage.setAlarm(Date.now() + 2 * MINUTE);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  }
  async alarm(): Promise<void> {
    await this.coordinator.load(scrapeDossier);
  }
}
