import {
  buildDossier, countParticipants, decodeEntities, parsePlayerCard, parseRoundClock,
  parseRoundPairing, parseSearchResults, parseStandings, parseTournamentMeta,
  pendingGameFromCard, rigaToday, type SearchHit,
} from "./parse";
import { ACTIVE_TTL, HISTORY_TTL, META_TTL, SEARCH_TTL, SourceError, type SourceContext } from "./coordinator.server";
import type { LoadResult, NextGame } from "./types";
const FIDE_ID = "11662255";
const UA = "ValtersAssistant/2.0 (personal chess dashboard; +https://kalns.eu)";
const MAX_TOURNAMENTS = 100;
const EXTRA_TOURNAMENTS: SearchHit[] = [
  {
    id: "1332728",
    snr: "4",
    name: "Avotiņš, Valters",
    fideId: "0",
    club: "",
    fed: "LAT",
    tournamentName: "V Chess Festival Cēsis 2026 - Turnīrs iesācējiem",
    endDate: "",
    rank: null,
    rounds: null,
    fieldSize: null,
    playerHref: "tnr1332728.aspx?lan=1&art=9&snr=4",
    tournamentHref: "tnr1332728.aspx?lan=1",
  },
  {
    id: "1438074",
    snr: "4",
    name: "Avotiņš, Valters",
    fideId: "0",
    club: "",
    fed: "LAT",
    tournamentName: "SmartCup 2026 - I posms (D turnīrs - iesācēji)",
    endDate: "",
    rank: null,
    rounds: null,
    fieldSize: null,
    playerHref: "tnr1438074.aspx?lan=1&art=9&snr=4",
    tournamentHref: "tnr1438074.aspx?lan=1",
  },
  {
    id: "1374865",
    snr: "2",
    name: "Avotiņš, Valters",
    fideId: "0",
    club: "",
    fed: "LAT",
    tournamentName: "Šahatons 2026- D",
    endDate: "",
    rank: null,
    rounds: null,
    fieldSize: null,
    playerHref: "tnr1374865.aspx?lan=1&art=9&snr=2",
    tournamentHref: "tnr1374865.aspx?lan=1",
  },
];

const EXTRA_PLACE: Record<string, string> = {
  "1332728": "Cēsis",
  "1374865": "Rīga",
};

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
async function searchPlayer(source: SourceContext): Promise<SearchHit[]> {
  return source.memo("search", SEARCH_TTL, async () => {
    const jar = new Map<string, string>();
    const page = await request(source, "https://chess-results.com/spielersuche.aspx?lan=1", jar);
    const field = (name: string) => {
      const tag = page.html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`, "i"))?.[0] || "";
      return decodeEntities(tag.match(/value="([^"]*)"/)?.[1] || "");
    };
    if (!field("__VIEWSTATE")) throw new Error("Meklēšanas lapa nav atpazīta.");
    const body = new URLSearchParams({
      __LASTFOCUS: "", __EVENTTARGET: "", __EVENTARGUMENT: "", __VIEWSTATE: field("__VIEWSTATE"),
      __VIEWSTATEGENERATOR: field("__VIEWSTATEGENERATOR"), __EVENTVALIDATION: field("__EVENTVALIDATION"),
      "ctl00$P1$txt_fideID": FIDE_ID, "ctl00$P1$combo_Sort": "0",
      "ctl00$P1$combo_anzahl_zeilen": "1", "ctl00$P1$cb_suchen": "Search",
    });
    const result = await request(source, page.url, jar, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: page.url, Origin: new URL(page.url).origin } });
    const hits = parseSearchResults(result.html).filter(h => h.fideId === FIDE_ID);
    if (!hits.length) throw new Error("Spēlētāja meklēšanas rezultāti nav atpazīti; iepriekšējā vēsture saglabāta.");
    const unique = new Map(hits.map(h => [h.id, h]));
    for (const extra of EXTRA_TOURNAMENTS) if (!unique.has(extra.id)) unique.set(extra.id, extra);
    return [...unique.values()].slice(0, MAX_TOURNAMENTS);
  });
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
  } catch {
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
    } catch {
      // The other list may still be public.
    }
  }
  return null;
}

export async function scrapeDossier(source: SourceContext): Promise<Extract<LoadResult, { ok: true }>> {
  const hits = await searchPlayer(source);
  const today = rigaToday();
  const cards = [], metas = [], nextGames: Array<NextGame | null> = [], standings = [], lastRoundAt: string[] = [];
  const preparedHits: SearchHit[] = [];
  // Serial source access, shared memo entries: historical pages are never fetched every refresh.
  for (const hit of hits) {
    const meta = await source.memo(`meta:shown:${hit.id}`, META_TTL, async () => parseTournamentMeta(await tournamentMetaHtml(source, hit.id)));
    meta.location ||= EXTRA_PLACE[hit.id] || "";
    if (!hit.fieldSize && !meta.fieldSize) {
      const size = await source.memo(`field:${hit.id}`, HISTORY_TTL, () => participantCount(source, hit.id));
      if (size) meta.fieldSize = size;
    }
    const endDate = meta.eventDate || hit.endDate;
    const active = meta.startDate <= today && endDate >= today;
    const card = await source.memo(`card:${hit.id}`, active ? ACTIVE_TTL : HISTORY_TTL, async () => {
      const parsed = parsePlayerCard((await request(source, `https://chess-results.com/tnr${hit.id}.aspx?lan=1&art=9&snr=${hit.snr}`)).html);
      const normalize = (name: string) => name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z]/g, "");
      if (normalize(parsed.name) !== normalize(hit.name)) throw new Error("Spēlētāja identitāte neatbilst; iepriekšējie dati saglabāti.");
      return parsed;
    });
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
          return { seat: parseRoundPairing(html, hit.snr, round, url), startsAt: parseRoundClock(html) };
        });
        if (parsed.seat?.pending) next = { ...parsed.seat, startsAt: parsed.startsAt };
        else if (next) next = { ...next, url, startsAt: parsed.startsAt };
      }
      neighbors = await source.memo(`standings:${hit.id}`, 15 * 60_000, async () => parseStandings((await request(source, `https://chess-results.com/tnr${hit.id}.aspx?lan=1&art=1`)).html, card.name, hit.snr));
    }
    preparedHits.push({ ...hit, endDate });
    cards.push(card); metas.push(meta); nextGames.push(next); standings.push(neighbors); lastRoundAt.push("");
  }
  return {
    ok: true, stale: false, warning: null,
    dossier: buildDossier({ hits: preparedHits, cards, metas, nextGames, standings, lastRoundAt, fetchedAt: new Date().toISOString(), today, fideId: FIDE_ID }),
  };
}

export async function loadDossier(_refresh = false): Promise<LoadResult> {
  // Neither manual refresh nor another browser may bypass the shared guard.
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
