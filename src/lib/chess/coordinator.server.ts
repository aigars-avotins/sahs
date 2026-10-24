import type { LoadResult } from "./types";
import { rigaToday } from "./parse";
import { isChessResultsUrl } from "./source-url";

export const MINUTE = 60_000;
export const ACTIVE_TTL = MINUTE;
export const SEARCH_TTL = 6 * 60 * MINUTE;
export const HISTORY_TTL = 7 * 24 * 60 * MINUTE;
export const META_TTL = 24 * 60 * MINUTE;
export const REQUEST_GAP = 2_000;

type Success = Extract<LoadResult, { ok: true }>;
export type CacheState = {
  version: 2;
  entries: Record<string, { at: number; value: unknown }>;
  snapshot?: Success;
  nextAllowedAt: number;
  nextRequestAt: number;
  failures: number;
  policy?: 1 | 2 | 3;
  lastError?: string;
  retryAfterUntil?: number;
};
export interface StateStore {
  read(): Promise<CacheState | undefined>;
  write(state: CacheState): Promise<void>;
}
export interface SourceContext {
  memo<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T>;
  request(url: string, init?: RequestInit): Promise<Response>;
}
export class SourceError extends Error {
  constructor(message: string, public retryAfter = 0) { super(message); }
}
export const emptyState = (): CacheState => ({ version: 2, entries: {}, nextAllowedAt: 0, nextRequestAt: 0, failures: 0 });

/** One coordinator per globally shared player, never one per visitor. */
export class SourceCoordinator {
  private pending: Promise<LoadResult> | null = null;
  constructor(
    private store: StateStore,
    // Native Workers fetch requires the global receiver, not this coordinator.
    private fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
    private now = Date.now,
    private pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ) {}

  load(job: (context: SourceContext) => Promise<Success>): Promise<LoadResult> {
    if (this.pending) return this.pending;
    this.pending = this.run(job).finally(() => { this.pending = null; });
    return this.pending;
  }

  private async run(job: (context: SourceContext) => Promise<Success>): Promise<LoadResult> {
    const saved = await this.store.read();
    const state = saved?.version === 2 ? saved : emptyState();
    // Repair cached local transport/allowlist errors after deployment while
    // retaining all pages and any explicit upstream hold.
    if ((state.lastError?.startsWith("Illegal invocation:") || state.lastError === "Avota novirzīšanas adrese nav atļauta.") && !state.retryAfterUntil) {
      state.nextAllowedAt = this.now();
      state.failures = 0;
      delete state.lastError;
    }
    if (state.policy !== 3) {
      if (state.policy !== 1 && state.policy !== 2) {
        // Shorten only our legacy first-error 15-minute guard. The old explicit
        // 403/429 guards were at least an hour and must not be bypassed.
        if (state.failures === 1 && state.nextAllowedAt <= state.nextRequestAt + 16 * MINUTE) {
          state.nextAllowedAt = Math.min(state.nextAllowedAt, Math.max(this.now(), state.nextRequestAt - REQUEST_GAP + ACTIVE_TTL));
        }
      } else if (!state.retryAfterUntil) {
        // The saved dossier predates historical dates and place counts.
        state.nextAllowedAt = this.now();
      }
      state.policy = 3;
      await this.store.write(state);
    }
    const reply = (snapshot: Success): Success => ({ ...snapshot, dossier: { ...snapshot.dossier, today: rigaToday(new Date(this.now())), nextCheckAt: new Date(state.nextAllowedAt).toISOString() } });
    if (this.now() < state.nextAllowedAt) {
      if (state.snapshot) return reply(state.snapshot);
      return { ok: false, error: state.lastError || "Iepriekšējā ielāde neizdevās. Tās iemesls vecajā versijā netika saglabāts.", nextCheckAt: new Date(state.nextAllowedAt).toISOString() };
    }
    // Persist before any network access: eviction/restart cannot reset the guard.
    state.nextAllowedAt = this.now() + ACTIVE_TTL;
    await this.store.write(state);
    const context: SourceContext = {
      memo: async <T,>(key: string, ttl: number, load: () => Promise<T>): Promise<T> => {
        const cached = state.entries[key];
        if (cached && this.now() - cached.at < ttl) return cached.value as T;
        const value = await load(); // Validate before replacing the last good value.
        state.entries[key] = { at: this.now(), value };
        await this.store.write(state);
        return value;
      },
      request: async (url, init) => {
        const target = new URL(url);
        if (!isChessResultsUrl(target)) {
          throw new SourceError(`Avota novirzīšanas adrese nav atļauta: ${target.hostname}.`);
        }
        const wait = state.nextRequestAt - this.now();
        if (wait > 0) await this.pause(wait);
        state.nextRequestAt = this.now() + REQUEST_GAP;
        await this.store.write(state);
        const response = await this.fetcher(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(20_000) });
        if (!response.ok && !(response.status >= 300 && response.status < 400)) {
          const raw = response.headers.get("retry-after");
          const seconds = raw ? Number(raw) : NaN;
          const delay = raw ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - this.now()) : 0;
          throw new SourceError(`chess-results.com atbildēja ar kļūdu ${response.status}.`, Math.max(Number.isFinite(delay) ? delay : 0, 0));
        }
        return response;
      },
    };
    try {
      const result = await job(context);
      const active = result.dossier.tournaments.some(t => t.startDate <= result.dossier.today && t.endDate >= result.dossier.today);
      state.failures = 0;
      delete state.lastError;
      delete state.retryAfterUntil;
      state.nextAllowedAt = this.now() + (active ? ACTIVE_TTL : SEARCH_TTL);
      state.snapshot = result;
      // Bound storage; keep source pages for tournaments still in the dossier.
      const ids = new Set(result.dossier.tournaments.map(t => t.id));
      for (const key of Object.keys(state.entries)) {
        const id = key.match(/^(?:card|meta:shown|meta:open|meta|round|standings|field):(\d+)/)?.[1];
        if (id && !ids.has(id)) delete state.entries[key];
      }
      await this.store.write(state);
      return reply(result);
    } catch (error) {
      state.failures += 1;
      const backoff = Math.min(15 * MINUTE, ACTIVE_TTL * 2 ** Math.min(state.failures - 1, 4));
      state.nextAllowedAt = this.now() + Math.max(backoff, error instanceof SourceError ? error.retryAfter : 0);
      const message = error instanceof Error ? error.message : "Neizdevās nolasīt avotu.";
      state.lastError = message;
      state.retryAfterUntil = error instanceof SourceError && error.retryAfter > 0 ? this.now() + error.retryAfter : undefined;
      if (state.snapshot) state.snapshot = { ...state.snapshot, stale: true, warning: `Atjaunošana neizdevās. ${message} Rādu pēdējos derīgos datus.` };
      await this.store.write(state);
      if (state.snapshot) return reply(state.snapshot);
      return { ok: false, error: message, nextCheckAt: new Date(state.nextAllowedAt).toISOString() };
    }
  }
}
