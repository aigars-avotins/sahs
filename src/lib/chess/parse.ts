import type {
  DayStatus,
  Dossier,
  Game,
  GameResult,
  Opponent,
  PieceColor,
  NextGame,
  Tournament,
} from "./types";

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  frac12: "½",
  frac14: "¼",
  ndash: "–",
  mdash: "—",
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (all, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = hex ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code)) return all;
      try {
        return String.fromCodePoint(code);
      } catch {
        return all;
      }
    }
    return NAMED[body] ?? all;
  });
}

export function cleanText(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " "))
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\u{2654}-\u{265F}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parsePoints(raw: string): number | null {
  const text = raw.trim().replace(/\s/g, "");
  if (!text || text === "-" || text === "–") return null;
  const half = text.match(/^(\d*)(½|1\/2)$/);
  if (half) return (half[1] ? Number(half[1]) : 0) + 0.5;
  const numeric = Number(text.replace(",", "."));
  return Number.isFinite(numeric) ? numeric : null;
}

export function parseResult(raw: string): { result: GameResult; score: number | null } {
  const text = raw.replace(/\s/g, "").replace(",", ".");
  if (text === "1" || text === "1.0" || text === "+" || text === "1-0") {
    return { result: "win", score: 1 };
  }
  if (text === "0" || text === "0.0" || text === "-" || text === "0-1") {
    return { result: "loss", score: 0 };
  }
  if (text === "½" || text === "1/2" || text === "0.5" || text === "=" || text === "½-½") {
    return { result: "draw", score: 0.5 };
  }
  return { result: "unknown", score: null };
}

export function formatPoints(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const whole = Math.floor(value + 1e-9);
  const fraction = value - whole;
  if (Math.abs(fraction) < 0.01) return String(whole);
  if (Math.abs(fraction - 0.5) < 0.01) return whole === 0 ? "½" : `${whole}½`;
  return value.toFixed(1).replace(".", ",");
}

export function formatDate(value: string): string {
  const match = value.match(/^(\d{4})[./-](\d{2})[./-](\d{2})/);
  if (!match) return value || "—";
  return `${match[3]}.${match[2]}.${match[1]}`;
}

export function isoDate(value: string): string {
  const slash = value.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  if (slash) return `${slash[1]}-${slash[2]}-${slash[3]}`;
  const dots = value.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (dots) return `${dots[3]}-${dots[2]}-${dots[1]}`;
  return "";
}

export function dayStatus(endDate: string, today: string): DayStatus {
  if (!endDate || !today) return "unknown";
  if (endDate === today) return "today";
  return endDate > today ? "upcoming" : "past";
}

export function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("lv-LV", {
    timeZone: "Europe/Riga",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function rigaToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Riga",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function pageTitle(html: string): string {
  const raw = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  return cleanText(raw).replace(/^Chess-Results(?: Server Chess-results\.com)?\s*-\s*/i, "");
}

function splitCells(rowHtml: string): string[] {
  const cells: string[] = [];
  let index = 0;
  while (index < rowHtml.length) {
    const open = rowHtml.indexOf("<td", index);
    if (open < 0) break;
    const openEnd = rowHtml.indexOf(">", open);
    if (openEnd < 0) break;
    let depth = 1;
    let cursor = openEnd + 1;
    while (cursor < rowHtml.length && depth > 0) {
      const nextOpen = rowHtml.indexOf("<td", cursor);
      const nextClose = rowHtml.indexOf("</td>", cursor);
      if (nextClose < 0) return cells;
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth += 1;
        const after = rowHtml.indexOf(">", nextOpen);
        cursor = (after < 0 ? nextOpen : after) + 1;
      } else {
        depth -= 1;
        if (depth === 0) {
          cells.push(rowHtml.slice(openEnd + 1, nextClose));
          index = nextClose + 5;
          break;
        }
        cursor = nextClose + 5;
      }
    }
    if (depth !== 0) break;
  }
  return cells;
}

function cellText(inner: string): string {
  return cleanText(inner);
}

function hrefOf(inner: string): string {
  const match = inner.match(/href="([^"]+)"/i);
  return match ? decodeEntities(match[1]) : "";
}

function tournamentId(href: string): string {
  return href.match(/tnr(\d+)/i)?.[1] ?? "";
}

function extractRows(html: string, classPrefix: "CRg" | "CRng"): string[] {
  const rows: string[] = [];
  const re = new RegExp(`<tr class="${classPrefix}[12]"\\s*>`, "gi");
  for (const match of html.matchAll(re)) {
    const start = match.index ?? 0;
    let cursor = start + match[0].length;
    let depth = 1;
    while (cursor < html.length && depth > 0) {
      const nextOpen = html.indexOf("<tr", cursor);
      const nextClose = html.indexOf("</tr>", cursor);
      if (nextClose < 0) break;
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth += 1;
        cursor = nextOpen + 3;
      } else {
        depth -= 1;
        cursor = nextClose + 5;
        if (depth === 0) rows.push(html.slice(start, cursor));
      }
    }
  }
  return rows;
}

export type SearchHit = {
  id: string;
  snr: string;
  name: string;
  fideId: string;
  club: string;
  fed: string;
  tournamentName: string;
  endDate: string;
  rank: number | null;
  rounds: number | null;
  fieldSize: number | null;
  playerHref: string;
  tournamentHref: string;
};

export function parseSearchResults(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const row of extractRows(html, "CRg")) {
    const cells = splitCells(row);
    if (cells.length < 8) continue;
    const playerHref = hrefOf(cells[0]);
    const id = tournamentId(playerHref);
    if (!id) continue;
    hits.push({
      id,
      snr: playerHref.match(/[?&]snr=(\d+)/i)?.[1] ?? "",
      name: cellText(cells[0]),
      fideId: cellText(cells[2]),
      club: cellText(cells[3]),
      fed: cellText(cells[4]),
      tournamentName: cellText(cells[5]),
      endDate: isoDate(cellText(cells[6])),
      rank: parsePoints(cellText(cells[7])),
      rounds: parsePoints(cellText(cells[8] ?? "")),
      fieldSize: parsePoints(cellText(cells[9] ?? "")),
      playerHref,
      tournamentHref: hrefOf(cells[5]),
    });
  }
  return hits;
}

export type CardParse = {
  name: string;
  tournamentName: string;
  points: number | null;
  rank: number | null;
  performance: number | null;
  startingRank: number | null;
  birthYear: string;
  games: Array<Omit<Game, "tournamentId" | "tournamentName" | "tournamentDate" | "location">>;
};

export function parsePlayerCard(html: string): CardParse {
  const info = new Map<string, string>();
  const infoRe =
    /<tr>\s*<td class="CR">\s*([^<]+?)\s*<\/td>\s*<td class="CR">\s*([^<]*)\s*<\/td>\s*<\/tr>/gi;
  for (const match of html.matchAll(infoRe)) {
    info.set(cleanText(match[1]).toLowerCase(), cleanText(match[2]));
  }
  const games: CardParse["games"] = [];
  for (const row of extractRows(html, "CRng")) {
    const cells = splitCells(row);
    if (cells.length < 10) continue;
    const opponent = cellText(cells[4]);
    if (!opponent) continue;
    const colorClass = cells[9].match(/class="(Farbe[^"]*)"/i)?.[1] ?? "";
    const color: PieceColor = /Farbew/i.test(colorClass) ? "white" : colorClass ? "black" : "unknown";
    const resultRaw = cellText(cells[9]);
    const parsed = parseResult(resultRaw);
    const rating = parsePoints(cellText(cells[5]));
    games.push({
      round: parsePoints(cellText(cells[0])) ?? 0,
      board: parsePoints(cellText(cells[1])) ?? 0,
      opponent,
      opponentTitle: cellText(cells[3]),
      opponentRating: rating && rating > 0 ? rating : null,
      opponentFed: cellText(cells[6]),
      opponentClub: cellText(cells[7]),
      opponentPoints: parsePoints(cellText(cells[8])),
      result: parsed.result,
      resultRaw,
      score: parsed.score,
      color,
    });
  }
  return {
    name: info.get("name") ?? "",
    tournamentName: pageTitle(html),
    points: parsePoints(info.get("points") ?? ""),
    rank: parsePoints(info.get("rank") ?? ""),
    performance: parsePoints(info.get("performance rating") ?? ""),
    startingRank: parsePoints(info.get("starting rank") ?? ""),
    birthYear: info.get("year of birth") ?? "",
    games,
  };
}

export type TournamentMeta = {
  name: string;
  location: string;
  timeControl: string;
  organizer: string;
  lastUpdate: string;
  eventDate: string;
  roundsScheduled: number | null;
};

export function parseTournamentMeta(html: string): TournamentMeta {
  const flat = cleanText(
    html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "),
  );
  const timeMatch = flat.match(/Time control(?:\s*\(([^)]+)\))?\s+(.+?)\s+Location/i);
  const rounds = flat.match(/Number of rounds\s+(\d+)/i)?.[1];
  return {
    name: pageTitle(html),
    location: flat.match(/Location\s+(.+?)\s+Number of rounds/i)?.[1]?.trim() ?? "",
    timeControl: [timeMatch?.[1], timeMatch?.[2]].filter(Boolean).join(" · "),
    organizer: flat.match(/Organizer\(s\)\s+(.+?)\s+Federation/i)?.[1]?.trim() ?? "",
    lastUpdate: flat.match(/Last update\s+([^,]+)/i)?.[1]?.trim() ?? "",
    eventDate: isoDate(flat.match(/\bDate\s+(\d{4}\/\d{2}\/\d{2})/i)?.[1] ?? ""),
    roundsScheduled: rounds ? Number(rounds) : null,
  };
}

export type RoundSeat = NextGame & { pending: boolean };

function pairingIsPending(raw: string): boolean {
  const text = raw.replace(/\s/g, "");
  if (!text || /^[-–:.*]+$/.test(text)) return true;
  return !/[01½+]/.test(text) && !text.includes("1/2");
}

export function parseRoundPairing(
  html: string,
  snr: string,
  round: number,
  pageUrl: string,
): RoundSeat | null {
  const wanted = snr.trim();
  if (!wanted) return null;
  for (const row of extractRows(html, "CRng")) {
    const cells = splitCells(row);
    if (cells.length < 10) continue;
    const whiteSnr = cells[4]?.match(/[?&]snr=(\d+)/i)?.[1] || cellText(cells[1] ?? "");
    const blackSnr = cells[12]?.match(/[?&]snr=(\d+)/i)?.[1] || cellText(cells[17] ?? "");
    const isWhite = whiteSnr === wanted;
    const isBlack = blackSnr === wanted;
    if (!isWhite && !isBlack) continue;
    const opponentCell = isWhite ? cells[12] : cells[4];
    const opponent = cellText(opponentCell ?? "") || "brīvs";
    const rating = parsePoints(cellText(isWhite ? (cells[15] ?? "") : (cells[7] ?? "")));
    return {
      round,
      board: parsePoints(cellText(cells[0] ?? "")) ?? 0,
      color: isWhite ? "white" : "black",
      opponent,
      opponentTitle: cellText(isWhite ? (cells[11] ?? "") : (cells[3] ?? "")),
      opponentRating: rating && rating > 0 ? rating : null,
      opponentFed: cellText(isWhite ? (cells[14] ?? "") : (cells[6] ?? "")),
      opponentPoints: parsePoints(cellText(isWhite ? (cells[10] ?? "") : (cells[8] ?? ""))),
      url: pageUrl,
      pending: pairingIsPending(cellText(cells[9] ?? "")),
    };
  }
  return null;
}

export function pendingGameFromCard(card: CardParse | null, playerHref: string): NextGame | null {
  if (!card) return null;
  const game = card.games
    .filter((row) => row.result === "unknown" && row.opponent)
    .sort((a, b) => b.round - a.round)[0];
  if (!game) return null;
  return {
    round: game.round,
    board: game.board,
    color: game.color,
    opponent: game.opponent,
    opponentTitle: game.opponentTitle,
    opponentRating: game.opponentRating,
    opponentFed: game.opponentFed,
    opponentPoints: game.opponentPoints,
    url: absoluteChessUrl(playerHref),
  };
}

function absoluteChessUrl(href: string): string {
  if (!href) return "https://chess-results.com/";
  if (href.startsWith("http")) return href;
  return `https://chess-results.com/${href.replace(/^\.\//, "")}`;
}

function longerName(...parts: Array<string | undefined>): string {
  return (
    parts
      .filter((part): part is string => Boolean(part && part.trim()))
      .sort((a, b) => b.length - a.length)[0] ?? ""
  );
}

function opponentKey(name: string, club: string): string {
  return `${name.toLocaleLowerCase("lv")}::${club.toLocaleLowerCase("lv")}`;
}

export function buildDossier(input: {
  hits: SearchHit[];
  cards: Array<CardParse | null>;
  metas: Array<TournamentMeta | null>;
  nextGames: Array<NextGame | null>;
  fetchedAt: string;
  today: string;
  fideId: string;
}): Dossier {
  const tournaments: Tournament[] = input.hits.map((hit, index) => {
    const card = input.cards[index];
    const meta = input.metas[index];
    const location = meta?.location ?? "";
    const name = longerName(meta?.name, card?.tournamentName, hit.tournamentName);
    const games: Game[] = (card?.games ?? []).map((game) => ({
      ...game,
      tournamentId: hit.id,
      tournamentName: name,
      tournamentDate: hit.endDate || meta?.eventDate || "",
      location,
    }));
    const nextGame = input.nextGames[index] ?? null;
    const endDate = hit.endDate || meta?.eventDate || "";
    const scoredRounds = new Set(
      games.filter((game) => game.score != null).map((game) => game.round),
    ).size;
    const scheduled = meta?.roundsScheduled ?? null;
    const live = Boolean(endDate) && endDate >= input.today;
    return {
      id: hit.id,
      name,
      url: absoluteChessUrl(hit.tournamentHref || `tnr${hit.id}.aspx?lan=1`),
      playerUrl: absoluteChessUrl(hit.playerHref),
      endDate,
      rank: card?.rank ?? hit.rank,
      rounds: hit.rounds,
      fieldSize: hit.fieldSize,
      club: hit.club,
      fed: hit.fed,
      points: card?.points ?? null,
      performance: card?.performance ?? null,
      startingRank: card?.startingRank ?? null,
      birthYear: card?.birthYear ?? "",
      location,
      timeControl: meta?.timeControl ?? "",
      organizer: meta?.organizer ?? "",
      lastUpdate: meta?.lastUpdate ?? "",
      roundsScheduled: scheduled,
      partial: card == null,
      awaitingPairing: Boolean(live && !nextGame && scheduled != null && scoredRounds < scheduled),
      nextGame,
      games,
    };
  });

  tournaments.sort((a, b) => (a.endDate < b.endDate ? 1 : a.endDate > b.endDate ? -1 : 0));

  const games = tournaments.flatMap((tournament) => tournament.games);
  const byOpponent = new Map<string, Opponent>();
  for (const game of games) {
    const key = opponentKey(game.opponent, game.opponentClub);
    let row = byOpponent.get(key);
    if (!row) {
      row = {
        key,
        name: game.opponent,
        club: game.opponentClub,
        fed: game.opponentFed,
        games: 0,
        scored: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        score: 0,
        lastDate: "",
        lastTournament: "",
        lastLocation: "",
        lastResult: "unknown",
        meetings: [],
      };
      byOpponent.set(key, row);
    }
    row.games += 1;
    row.meetings.push(game);
    if (game.score != null) {
      row.scored += 1;
      row.score += game.score;
      if (game.result === "win") row.wins += 1;
      if (game.result === "draw") row.draws += 1;
      if (game.result === "loss") row.losses += 1;
    }
  }

  const opponents = [...byOpponent.values()];
  for (const opponent of opponents) {
    opponent.meetings.sort((a, b) => {
      if (a.tournamentDate !== b.tournamentDate) return a.tournamentDate < b.tournamentDate ? 1 : -1;
      return b.round - a.round;
    });
    const latest = opponent.meetings[0];
    if (latest) {
      opponent.lastDate = latest.tournamentDate;
      opponent.lastTournament = latest.tournamentName;
      opponent.lastLocation = latest.location;
      opponent.lastResult = latest.result;
    }
  }
  opponents.sort((a, b) => b.games - a.games || b.score - a.score || a.name.localeCompare(b.name, "lv"));

  const scored = games.filter((game) => game.score != null);
  const ranks = tournaments
    .map((tournament) => tournament.rank)
    .filter((rank): rank is number => rank != null && rank > 0);
  const profile = tournaments[0];
  const missing = tournaments.filter((tournament) => tournament.partial).length;
  const siteName = input.hits.find((hit) => hit.name)?.name || "Avotins, Valters";

  return {
    player: {
      name: siteName,
      fideId: input.fideId,
      birthYear: tournaments.find((tournament) => tournament.birthYear)?.birthYear ?? "",
      club: profile?.club ?? "",
      fed: profile?.fed ?? "LAT",
    },
    fetchedAt: input.fetchedAt,
    today: input.today,
    tournaments,
    opponents,
    totals: {
      tournaments: tournaments.length,
      games: games.length,
      scored: scored.length,
      wins: scored.filter((game) => game.result === "win").length,
      draws: scored.filter((game) => game.result === "draw").length,
      losses: scored.filter((game) => game.result === "loss").length,
      score: scored.reduce((sum, game) => sum + (game.score ?? 0), 0),
      bestRank: ranks.length ? Math.min(...ranks) : null,
    },
    partialNote:
      missing > 0
        ? "Daļu turnīru lapu neizdevās nolasīt. Spied «Atjaunot», lai mēģinātu vēlreiz."
        : null,
  };
}
