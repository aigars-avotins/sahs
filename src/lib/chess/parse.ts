import type {
  DayStatus,
  Dossier,
  Game,
  GameResult,
  Opponent,
  PieceColor,
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
