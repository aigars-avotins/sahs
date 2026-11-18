import { isPlayed, opponentRecord, totalsFor } from "./parse";
import type { Dossier, Game, Opponent, Tournament } from "./types";

export type Pace = "rapid" | "blitz" | "classical" | "unknown";

/** FIDE: blitz is 10 min or less, rapid more than 10 and less than 60, standard 60 or more (base + 60 moves of increment). */
export function paceOf(control: string): Pace {
  if (/blitz|blic/i.test(control)) return "blitz";
  if (/rapid|ātr/i.test(control)) return "rapid";
  if (/standard|classical|klasisk/i.test(control)) return "classical";
  const match = control.match(/(?:^|\D)(\d+)\s*(?:min|\+|')/i);
  if (!match) return "unknown";
  const minutes = Number(match[1]);
  const increment = Number(control.match(/\+\s*(\d+)/)?.[1] || 0);
  const effective = minutes + increment;
  return effective <= 10 ? "blitz" : effective < 60 ? "rapid" : "classical";
}

export function scopedDossier(dossier: Dossier, tournaments: Tournament[]): Dossier {
  const ids = new Set(tournaments.map(t => t.id));
  const opponents: Opponent[] = dossier.opponents.flatMap(opponent => {
    const meetings = opponent.meetings.filter(g => ids.has(g.tournamentId));
    return meetings.length ? [opponentRecord(opponent, meetings)] : [];
  });
  return { ...dossier, tournaments, opponents, totals: totalsFor(tournaments) };
}

/** Percentage of points from games played over the board. */
export function scoreRate(games: Game[]): number | null {
  const played = games.filter(isPlayed);
  return played.length ? Math.round(played.reduce((s, g) => s + (g.score || 0), 0) / played.length * 100) : null;
}
