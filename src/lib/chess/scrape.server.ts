import {
  buildDossier,
  decodeEntities,
  parsePlayerCard,
  parseSearchResults,
  parseTournamentMeta,
  rigaToday,
  type SearchHit,
} from "./parse";
import type { LoadResult } from "./types";

const FIDE_ID = "11662255";
const UA = "ValtersAssistant/1.0 (personal chess dashboard; +https://kalns.eu)";
const TTL_MS = 45_000;
const MAX_TOURNAMENTS = 15;

type CacheEntry = { at: number; result: Extract<LoadResult, { ok: true }> };
let cache: CacheEntry | null = null;

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

function storeCookies(jar: Map<string, string>, response: Response) {
  const list =
    typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  for (const cookie of list) {
    const pair = cookie.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

async function request(
  url: string,
  jar: Map<string, string>,
  init?: RequestInit,
): Promise<{ url: string; html: string }> {
  let current = url;
  for (let hop = 0; hop < 6; hop += 1) {
    const response = await fetch(current, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en",
        ...(jar.size ? { Cookie: cookieHeader(jar) } : {}),
        ...(init?.headers ?? {}),
      },
    });
    storeCookies(jar, response);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("chess-results.com novirzīja bez adreses.");
      current = new URL(location, current).href;
      continue;
    }
    const html = await response.text();
    if (!response.ok) {
      throw new Error(`chess-results.com atbildēja ar kļūdu ${response.status}.`);
    }
    return { url: current, html };
  }
  throw new Error("chess-results.com pārāk daudz novirzīja.");
}

async function searchPlayer(): Promise<SearchHit[]> {
  const jar = new Map<string, string>();
  const page = await request("https://chess-results.com/spielersuche.aspx?lan=1", jar);
  const field = (name: string) => {
    const tag = page.html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`, "i"))?.[0] ?? "";
    const raw = tag.match(/value="([^"]*)"/)?.[1] ?? "";
    return decodeEntities(raw);
  };
  const body = new URLSearchParams({
    __LASTFOCUS: "",
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __VIEWSTATE: field("__VIEWSTATE"),
    __VIEWSTATEGENERATOR: field("__VIEWSTATEGENERATOR"),
    __EVENTVALIDATION: field("__EVENTVALIDATION"),
    "ctl00$P1$txt_fideID": FIDE_ID,
    "ctl00$P1$combo_Sort": "0",
    "ctl00$P1$combo_anzahl_zeilen": "1",
    "ctl00$P1$cb_suchen": "Search",
  });
  const result = await request(page.url, jar, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: page.url,
      Origin: new URL(page.url).origin,
    },
    body,
  });
  return parseSearchResults(result.html).filter((hit) => hit.fideId === FIDE_ID).slice(0, MAX_TOURNAMENTS);
}

async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => worker()));
  return out;
}

async function fetchHtml(url: string): Promise<string> {
  const { html } = await request(url, new Map());
  return html;
}

export async function loadDossier(refresh: boolean): Promise<LoadResult> {
  if (!refresh && cache && Date.now() - cache.at < TTL_MS) {
    return cache.result;
  }
  try {
    const hits = await searchPlayer();
    const [cards, metas] = await Promise.all([
      mapPool(hits, 4, async (hit) => {
        try {
          const html = await fetchHtml(
            `https://chess-results.com/tnr${hit.id}.aspx?lan=1&art=9&snr=${hit.snr}`,
          );
          return parsePlayerCard(html);
        } catch {
          return null;
        }
      }),
      mapPool(hits, 4, async (hit) => {
        try {
          const html = await fetchHtml(`https://chess-results.com/tnr${hit.id}.aspx?lan=1&turdet=YES`);
          return parseTournamentMeta(html);
        } catch {
          return null;
        }
      }),
    ]);
    const dossier = buildDossier({
      hits,
      cards,
      metas,
      fetchedAt: new Date().toISOString(),
      today: rigaToday(),
      fideId: FIDE_ID,
    });
    const result: Extract<LoadResult, { ok: true }> = {
      ok: true,
      dossier,
      stale: false,
      warning: null,
    };
    cache = { at: Date.now(), result };
    return result;
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Neizdevās nolasīt chess-results.com.";
    if (cache) {
      return {
        ...cache.result,
        stale: true,
        warning: `Atjaunošana neizdevās (${message}). Rādu pēdējos nolasītos datus.`,
      };
    }
    return { ok: false, error: message };
  }
}
