import {
  buildDossier, countParticipants, decodeEntities, parsePlayerCard, parseRoundClock,
  parseRoundPairing, parseSearchResults, parseStandings, parseTournamentMeta,
  isBye, parseRoundDate, pendingGameFromCard, rigaToday, type CardParse, type SearchHit, type TournamentMeta,
} from "./parse";
import { EXTRA_PLACE, EXTRA_TOURNAMENTS, PLAYER } from "./config";
import { ACTIVE_TTL, HISTORY_TTL, META_TTL, MINUTE, SEARCH_TTL, SourceError, isRefusal, type SourceContext } from "./coordinator.server";
import type { LoadResult, NextGame, OpponentGlance, Standings } from "./types";
const FIDE_ID = PLAYER.fideId;
const UA = "ValtersAssistant/2.0 (personal chess dashboard; +https://kalns.eu)";
const MAX_TOURNAMENTS = 100;
/** Card refresh for the first days after a tournament ends, until late final results are in. */
const FINISH_TTL = 60 * MINUTE;
const SEARCH_URL = "https://chess-results.com/spielersuche.aspx?lan=1";

function storeCookies(jar: Map<string, string>, response: Response) {
  const list = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  for (const cookie of list) {
    const pair = cookie.split(";")[0] || "";
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
async function request(source: SourceContext, url: string, jar = new Map<string, string>(), init?: RequestInit): Promise<{ url: string; html: string }> {
  let current = url;
  let options = init;
  for (let hop = 0; hop < 4; hop++) {
    const response = await source.request(current, {
      ...options, redirect: "manual",
      headers: {
        "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en",
        ...(jar.size ? { Cookie: [...jar.entries()].map(([k,v]) => `${k}=${v}`).join("; ") } : {}),
        ...options?.headers,
      },
    });
    storeCookies(jar, response);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new SourceError("Avots novirzīja bez adreses.");
      current = new URL(location, current).href;
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && options?.method === "POST")) options = undefined;
      continue;
    }
    const html = await response.text();
    if (/captcha|verify you are human|cf-chl-|access denied/i.test(html)) throw new SourceError("Avots pieprasa pārbaudi; pieprasījumi apturēti.", 15 * 60_000);
    return { url: current, html };
  }
  throw new SourceError("Avots pārāk daudz novirzīja.");
}
/** Player search by FIDE ID; null when the search form itself is not recognized. */
async function searchFide(source: SourceContext, fideId: string): Promise<SearchHit[] | null> {
  const jar = new Map<string, string>();
  const page = await request(source, SEARCH_URL, jar);
  if (!formField(page.html, "__VIEWSTATE")) return null;
  const body = new URLSearchParams({
    __LASTFOCUS: "", __EVENTTARGET: "", __EVENTARGUMENT: "", __VIEWSTATE: formField(page.html, "__VIEWSTATE"),
    __VIEWSTATEGENERATOR: formField(page.html, "__VIEWSTATEGENERATOR"), __EVENTVALIDATION: formField(page.html, "__EVENTVALIDATION"),
    "ctl00$P1$txt_fideID": fideId, "ctl00$P1$combo_Sort": "0",
    "ctl00$P1$combo_anzahl_zeilen": "1", "ctl00$P1$cb_suchen": "Search",
  });
  const result = await request(source, page.url, jar, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: page.url, Origin: new URL(page.url).origin } });
  return parseSearchResults(result.html).filter(h => h.fideId === fideId);
}

async function searchPlayer(source: SourceContext): Promise<SearchHit[]> {
  return source.memo("search", SEARCH_TTL, async () => {
    const hits = await searchFide(source, FIDE_ID);
    if (!hits) throw new Error("Meklēšanas lapa nav atpazīta.");
    if (!hits.length) throw new Error("Spēlētāja meklēšanas rezultāti nav atpazīti; iepriekšējā vēsture saglabāta.");
    const unique = new Map(hits.map(h => [h.id, h]));
    for (const extra of EXTRA_TOURNAMENTS) if (!unique.has(extra.id)) unique.set(extra.id, extra);
    return [...unique.values()].slice(0, MAX_TOURNAMENTS);
  });
}

async function searchByFide(source: SourceContext, fideId: string): Promise<SearchHit[]> {
  return source.memo(`glance:${fideId}`, HISTORY_TTL, async () => (await searchFide(source, fideId) ?? []).slice(0, 30));
}

function glanceFrom(fideId: string, hits: SearchHit[]): OpponentGlance {
  const recent = [...hits]
    .sort((a, b) => (a.endDate < b.endDate ? 1 : a.endDate > b.endDate ? -1 : 0))
    .slice(0, 3)
    .map((hit) => ({
      name: hit.tournamentName,
      endDate: hit.endDate,
      rank: hit.rank,
      rounds: hit.rounds,
      fieldSize: hit.fieldSize,
    }));
  const ranks = hits.map((hit) => hit.rank).filter((rank): rank is number => rank != null && rank > 0);
  return {
    fideId,
    tournaments: hits.length,
    bestRank: ranks.length ? Math.min(...ranks) : null,
    recent,
  };
}

async function withGlance(source: SourceContext, next: NextGame, tournamentId: string): Promise<NextGame> {
  if (isBye(next.opponent)) return next;
  try {
    let fide = next.opponentFideId && next.opponentFideId !== "0" ? next.opponentFideId : "";
    if (!fide && next.opponentSnr) {
      const snr = next.opponentSnr;
      fide = await source.memo(`opp:${tournamentId}:${snr}`, HISTORY_TTL, async () =>
        parsePlayerCard((await request(source, `https://chess-results.com/tnr${tournamentId}.aspx?lan=1&art=9&snr=${snr}`)).html).fideId,
      );
    }
    if (!fide || fide === "0" || fide === FIDE_ID) return next;
    const hits = await searchByFide(source, fide);
    if (!hits.length) return { ...next, opponentFideId: fide };
    return { ...next, opponentFideId: fide, glance: glanceFrom(fide, hits) };
  } catch (error) {
    // The glance is optional, but a source refusal must reach the coordinator's guard.
    if (isRefusal(error)) throw error;
    return next;
  }
}

function formField(html: string, name: string): string {
  const tag = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`, "i"))?.[0] || "";
  return decodeEntities(tag.match(/value="([^"]*)"/)?.[1] || "");
}

const DETAILS_BUTTON = /(?:id|name)=["'](?:ctl00_P1_|ctl00\$P1\$)?cb_alleDetails["']/i;

async function tournamentMetaHtml(source: SourceContext, id: string): Promise<string> {
  const jar = new Map<string, string>();
  const page = await request(source, `https://chess-results.com/tnr${id}.aspx?lan=1&turdet=YES`, jar);
  if (!DETAILS_BUTTON.test(page.html) || !formField(page.html, "__VIEWSTATE")) return page.html;
  try {
    const body = new URLSearchParams({
      __EVENTTARGET: "",
      __EVENTARGUMENT: "",
      __VIEWSTATE: formField(page.html, "__VIEWSTATE"),
      __VIEWSTATEGENERATOR: formField(page.html, "__VIEWSTATEGENERATOR"),
      __EVENTVALIDATION: formField(page.html, "__EVENTVALIDATION"),
      cb_alleDetails: "Show tournament details",
    });
    const opened = await request(source, page.url, jar, {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: page.url,
        Origin: new URL(page.url).origin,
      },
    });
    const text = opened.html.replace(/<[^>]+>/g, " ");
    if (!DETAILS_BUTTON.test(opened.html) || /Number of rounds\s+\d+/i.test(text) || /\bDate\s+\d{4}\/\d{2}\/\d{2}/i.test(text)) return opened.html;
  } catch (error) {
    if (isRefusal(error)) throw error;
    // The closed page still has the games; missing place and date stay marked hidden.
  }
  return page.html;
}

async function participantCount(source: SourceContext, id: string): Promise<number | null> {
  for (const art of ["1", "0"]) {
    try {
      const html = (await request(source, `https://chess-results.com/tnr${id}.aspx?lan=1&art=${art}&fed=LAT&turdet=YES&flag=30`)).html;
      const count = countParticipants(html);
      if (count) return count;
    } catch (error) {
      if (isRefusal(error)) throw error;
      // The other list may still be public.
    }
  }
  return null;
}

export async function scrapeDossier(source: SourceContext): Promise<Extract<LoadResult, { ok: true }>> {
  const hits = await searchPlayer(source);
  const today = rigaToday();
  const cards: Array<CardParse | null> = [], metas: Array<TournamentMeta | null> = [], nextGames: Array<NextGame | null> = [], standings: Array<Standings | null> = [];
  const preparedHits: SearchHit[] = [];
  // Serial source access, shared memo entries: historical pages are never fetched every refresh.
  for (const hit of hits) {
    let active = false;
    try {
      const row = await tournamentData(source, hit, today, (value) => { active = value; });
      preparedHits.push(row.hit); cards.push(row.card); metas.push(row.meta); nextGames.push(row.next); standings.push(row.neighbors);
    } catch (error) {
      // A refusal stops everything (the guard must see it), and so does a broken running tournament:
      // the last good snapshot is better than one without its games.
      if (isRefusal(error) || active) throw error;
      // One old tournament that disappeared or changed layout must not block the live ones.
      preparedHits.push(hit); cards.push(null); metas.push(null); nextGames.push(null); standings.push(null);
    }
  }
  return {
    ok: true, stale: false, warning: null,
    dossier: buildDossier({ hits: preparedHits, cards, metas, nextGames, standings, fetchedAt: new Date().toISOString(), today, fideId: FIDE_ID }),
  };
}

async function tournamentData(source: SourceContext, hit: SearchHit, today: string, onActive: (active: boolean) => void) {
  const cached = await source.memo(`meta:shown:${hit.id}`, META_TTL, async () => parseTournamentMeta(await tournamentMetaHtml(source, hit.id)), { keepStale: true });
  // Copy: the memoized value is shared state and must not absorb local fallbacks.
  const meta = { ...cached, location: cached.location || EXTRA_PLACE[hit.id] || "" };
  if (!hit.fieldSize && !meta.fieldSize) {
    const size = await source.memo(`field:${hit.id}`, HISTORY_TTL, () => participantCount(source, hit.id));
    if (size) meta.fieldSize = size;
  }
  const endDate = meta.eventDate || hit.endDate;
  const active = meta.startDate <= today && endDate >= today;
  onActive(active);
  // The final round's result often appears after the last visit of the day: re-check hourly for a few days.
  const justEnded = !active && Boolean(endDate) && endDate < today && endDate >= daysBefore(today, 3);
  const card = await source.memo(`card:${hit.id}`, active ? ACTIVE_TTL : justEnded ? FINISH_TTL : HISTORY_TTL, async () => {
    const parsed = parsePlayerCard((await request(source, `https://chess-results.com/tnr${hit.id}.aspx?lan=1&art=9&snr=${hit.snr}`)).html);
    const normalize = (name: string) => name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z]/g, "");
    if (normalize(parsed.name) !== normalize(hit.name)) throw new Error("Spēlētāja identitāte neatbilst; iepriekšējie dati saglabāti.");
    return parsed;
  }, { keepStale: !active });
  let next: NextGame | null = null;
  let neighbors = null;
  if (active) {
    next = pendingGameFromCard(card, hit.playerHref);
    const lastRound = Math.max(0, ...card.games.filter(g => g.score != null).map(g => g.round));
    const round = next?.round || lastRound + 1;
    if (round <= (meta.roundsScheduled ?? round)) {
      const url = `https://chess-results.com/tnr${hit.id}.aspx?lan=1&art=2&rd=${round}&flag=30`;
      const parsed = await source.memo(`round:${hit.id}:${round}`, ACTIVE_TTL, async () => {
        const html = (await request(source, url)).html;
        if (!/<title>[\s\S]*Chess-Results/i.test(html) && !/class=["']CR/i.test(html)) throw new Error("Izlozes lapa nav atpazīta.");
        return { seat: parseRoundPairing(html, hit.snr, round, url), startsAt: parseRoundClock(html), startsOn: parseRoundDate(html) };
      });
      const when = { startsAt: parsed.startsAt, startsOn: parsed.startsOn || undefined };
      if (parsed.seat?.pending) next = { ...parsed.seat, ...when };
      else if (next) next = { ...next, url, ...when };
    }
    neighbors = await source.memo(`standings:${hit.id}`, 15 * 60_000, async () => parseStandings((await request(source, `https://chess-results.com/tnr${hit.id}.aspx?lan=1&art=1`)).html, card.name, hit.snr));
  }
  if (next) next = await withGlance(source, next, hit.id);
  return { hit: { ...hit, endDate }, card, meta, next, neighbors };
}

function daysBefore(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export async function loadDossier(): Promise<LoadResult> {
  // There is deliberately no "force" option: neither the refresh button nor another browser may bypass the shared guard.
  if (import.meta.env.VITE_CLOUDFLARE === "1") {
    const { env } = await import("cloudflare:workers");
    const namespace = (env as unknown as { CHESS_CACHE: DurableObjectNamespace }).CHESS_CACHE;
    if (!namespace) throw new Error("CHESS_CACHE saistījums nav konfigurēts.");
    const response = await namespace.get(namespace.idFromName("valters-source-v2")).fetch("https://cache/dossier");
    return response.json() as Promise<LoadResult>;
  }
  const { loadWithFileCache } = await import("./file-cache.server");
  return loadWithFileCache(scrapeDossier);
}
