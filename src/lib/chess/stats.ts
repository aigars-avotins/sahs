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
    if (!meetings.length) return [];
    const scored = meetings.filter(g => g.score != null);
    return [{ ...opponent, meetings, games: scored.length, pending: meetings.length - scored.length, scored: scored.length,
      wins: scored.filter(g => g.result === "win").length, draws: scored.filter(g => g.result === "draw").length,
      losses: scored.filter(g => g.result === "loss").length, score: scored.reduce((s,g) => s + (g.score || 0), 0),
    }];
  });
  const games = tournaments.flatMap(t => t.games);
  const scored = games.filter(g => g.score != null);
  const ranks = tournaments.flatMap(t => t.rank && t.rank > 0 ? [t.rank] : []);
  return { ...dossier, tournaments, opponents, totals: {
    tournaments: tournaments.length, games: scored.length, pending: games.length - scored.length,
    scored: scored.length, wins: scored.filter(g => g.result === "win").length,
    draws: scored.filter(g => g.result === "draw").length, losses: scored.filter(g => g.result === "loss").length,
    score: scored.reduce((s,g) => s + (g.score || 0), 0), bestRank: ranks.length ? Math.min(...ranks) : null,
  } };
}
export function scoreRate(games: Game[]): number | null {
  const scored = games.filter(g => g.score != null);
  return scored.length ? Math.round(scored.reduce((s,g) => s + (g.score || 0), 0) / scored.length * 100) : null;
}
