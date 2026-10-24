import {
  buildDossier,
  decodeEntities,
  parsePlayerCard,
  parseRoundClock,
  parseRoundPairing,
  parseSearchResults,
  parseStandings,
  parseTournamentMeta,
  pendingGameFromCard,
  rigaToday,
  type CardParse,
  type SearchHit,
  type TournamentMeta,
} from "./parse";
import type { LoadResult, NextGame } from "./types";

const FIDE_ID = "11662255";
const UA = "ValtersAssistant/1.0 (personal chess dashboard; +https://kalns.eu)";
const TTL_MS = 45_000;
const MAX_TOURNAMENTS = 15;

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

function withExtraTournaments(hits: SearchHit[]): SearchHit[] {
  const seen = new Set(hits.map((hit) => hit.id));
  return [...hits, ...EXTRA_TOURNAMENTS.filter((hit) => !seen.has(hit.id))];
}

function dateFromStamp(stamp: string): string {
  const match = stamp.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
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

async function resolveNextGame(
  hit: SearchHit,
  card: CardParse | null,
  meta: TournamentMeta | null,
  today: string,
): Promise<NextGame | null> {
  const end = hit.endDate || meta?.eventDate || "";
  if (!end || end < today) return null;
  const fromCard = pendingGameFromCard(card, hit.playerHref);
  if (fromCard) {
    try {
      const url = `https://chess-results.com/tnr${hit.id}.aspx?lan=1&art=2&rd=${fromCard.round}&flag=30`;
      const html = await fetchHtml(url);
      fromCard.publishedAt = parseRoundClock(html);
      fromCard.url = url;
    } catch {
      /* the pairing on the card is enough */
    }
    return fromCard;
  }
  const scheduled = meta?.roundsScheduled ?? null;
  let round = (card?.games.reduce((max, game) => Math.max(max, game.round), 0) ?? 0) + 1;
  if (round < 1) round = 1;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (scheduled != null && round > scheduled) return null;
    try {
      const url = `https://chess-results.com/tnr${hit.id}.aspx?lan=1&art=2&rd=${round}&flag=30`;
      const html = await fetchHtml(url);
      const seat = parseRoundPairing(html, hit.snr, round, url);
      if (!seat) return null;
      if (seat.pending) {
        return {
          round: seat.round,
          board: seat.board,
          color: seat.color,
          opponent: seat.opponent,
          opponentTitle: seat.opponentTitle,
          opponentRating: seat.opponentRating,
          opponentFed: seat.opponentFed,
          opponentPoints: seat.opponentPoints,
          url: seat.url,
          publishedAt: parseRoundClock(html),
        };
      }
      round += 1;
    } catch {
      return null;
    }
  }
  return null;
}

export async function loadDossier(refresh: boolean): Promise<LoadResult> {
  if (!refresh && cache && Date.now() - cache.at < TTL_MS) {
    return cache.result;
  }
  try {
    const hits = withExtraTournaments(await searchPlayer());
    const today = rigaToday();
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
    const nextGames = await mapPool(
      hits.map((hit, index) => ({ hit, index })),
      4,
      ({ hit, index }) => resolveNextGame(hit, cards[index] ?? null, metas[index] ?? null, today),
    );
    const liveExtras = await mapPool(
      hits.map((hit, index) => ({ hit, index })),
      4,
      async ({ hit, index }) => {
        const end = hit.endDate || metas[index]?.eventDate || "";
        if (!end || end < today) return { standings: null, lastRoundAt: "" };
        let standings = null;
        try {
          const html = await fetchHtml(`https://chess-results.com/tnr${hit.id}.aspx?lan=1&art=1`);
          standings = parseStandings(html, cards[index]?.name || hit.name);
        } catch {
          standings = null;
        }
        let lastRoundAt = "";
        const lastRound = cards[index]?.games.reduce((max, game) => Math.max(max, game.round), 0) ?? 0;
        if (!nextGames[index]?.publishedAt && lastRound > 0) {
          try {
            const html = await fetchHtml(
              `https://chess-results.com/tnr${hit.id}.aspx?lan=1&art=2&rd=${lastRound}&flag=30`,
            );
            lastRoundAt = parseRoundClock(html);
          } catch {
            lastRoundAt = "";
          }
        }
        return { standings, lastRoundAt };
      },
    );
    const extraIds = new Set(EXTRA_TOURNAMENTS.map((hit) => hit.id));
    const preparedHits = hits.map((hit, index) => {
      if (!extraIds.has(hit.id)) return hit;
      const card = cards[index];
      const meta = metas[index];
      return {
        ...hit,
        name: card?.name || hit.name,
        endDate: hit.endDate || meta?.eventDate || dateFromStamp(meta?.lastUpdate ?? ""),
        rank: card?.rank ?? hit.rank,
        rounds: card?.games.length || hit.rounds,
        fieldSize: meta?.fieldSize ?? hit.fieldSize,
        fed: "LAT",
      };
    });
    const preparedMetas = metas.map((meta, index) => {
      const hit = hits[index];
      if (!hit || !extraIds.has(hit.id) || !meta) return meta;
      return {
        ...meta,
        location: meta.location || EXTRA_PLACE[hit.id] || "",
        eventDate: meta.eventDate || dateFromStamp(meta.lastUpdate),
        roundsScheduled: meta.roundsScheduled ?? cards[index]?.games.length ?? null,
      };
    });
    const dossier = buildDossier({
      hits: preparedHits,
      cards,
      metas: preparedMetas,
      nextGames,
      standings: liveExtras.map((extra) => extra.standings),
      lastRoundAt: liveExtras.map((extra) => extra.lastRoundAt),
      fetchedAt: new Date().toISOString(),
      today,
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
