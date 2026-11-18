import { SPORT_CLASS } from "./config";
import { foldName, isPlayed } from "./parse";
import { paceOf } from "./stats";
import type { Game, Opponent, Tournament } from "./types";

/** Wins, draws and losses of games played over the board. */
export type Tally = { games: number; wins: number; draws: number; losses: number; score: number };

export function recordOf(games: Game[]): Tally {
  const played = games.filter(isPlayed);
  return {
    games: played.length,
    wins: played.filter((game) => game.result === "win").length,
    draws: played.filter((game) => game.result === "draw").length,
    losses: played.filter((game) => game.result === "loss").length,
    score: played.reduce((sum, game) => sum + (game.score ?? 0), 0),
  };
}

export function rateOf(record: Tally): number | null {
  return record.games ? Math.round((record.score / record.games) * 100) : null;
}

export type PaceFilter = "all" | "rapid" | "other";

/** Shared by Turnīri, Pretinieki and Statistika so the filters mean the same everywhere. */
export function filterTournaments(tournaments: Tournament[], year: string, pace: PaceFilter): Tournament[] {
  return tournaments.filter((tournament) => {
    if (year !== "all" && !tournament.endDate.startsWith(year)) return false;
    const kind = paceOf(tournament.timeControl);
    if (pace === "rapid" && kind !== "rapid") return false;
    if (pace === "other" && (kind === "rapid" || kind === "unknown")) return false;
    return true;
  });
}

export function tournamentYears(tournaments: Tournament[]): string[] {
  const found = new Set(tournaments.map((tournament) => tournament.endDate.slice(0, 4)).filter(Boolean));
  return [...found].sort((a, b) => (a < b ? 1 : -1));
}

export function sportClass(tournament: Tournament): string | null {
  if (SPORT_CLASS[tournament.id]) return SPORT_CLASS[tournament.id];
  const name = tournament.name.toLowerCase();
  if (name.includes("iesācēj")) return "Iesācēji";
  if (/3\s*\.?\s*sp\.?\s*kl/.test(name)) return "3. sporta klase";
  if (/4\s*\.?\s*sp\.?\s*kl/.test(name)) return "4. sporta klase";
  return null;
}

/**
 * Opponents met two or more times, merged by name: at this level most players have no
 * FIDE ID, so the name is the only identity there is.
 */
export function repeatOpponents(opponents: Opponent[]): Opponent[] {
  const groups = new Map<string, Opponent[]>();
  for (const opponent of opponents) {
    const key = foldName(opponent.name);
    groups.set(key, [...(groups.get(key) ?? []), opponent]);
  }
  const rows: Opponent[] = [];
  for (const group of groups.values()) {
    const games = group.reduce((sum, opponent) => sum + opponent.games, 0);
    if (games < 2) continue;
    if (group.length === 1) {
      rows.push(group[0]);
      continue;
    }
    const [first] = group;
    rows.push({
      ...first,
      key: `repeat:${foldName(first.name)}`,
      club: [...new Set(group.map((opponent) => opponent.club).filter(Boolean))].join(" · "),
      games,
      meetings: group.flatMap((opponent) => opponent.meetings),
      wins: group.reduce((sum, opponent) => sum + opponent.wins, 0),
      draws: group.reduce((sum, opponent) => sum + opponent.draws, 0),
      losses: group.reduce((sum, opponent) => sum + opponent.losses, 0),
      score: group.reduce((sum, opponent) => sum + opponent.score, 0),
      scored: group.reduce((sum, opponent) => sum + opponent.scored, 0),
    });
  }
  return rows;
}

const byDate = (a: Tournament, b: Tournament) => {
  const left = a.startDate || a.endDate;
  const right = b.startDate || b.endDate;
  return left < right ? -1 : left > right ? 1 : 0;
};

/** Tournaments oldest first, each with its games that have a result, in round order. */
export function resultsByTournament(tournaments: Tournament[]): Array<{ tournament: Tournament; games: Game[] }> {
  return [...tournaments]
    .sort(byDate)
    .map((tournament) => ({
      tournament,
      games: tournament.games.filter((game) => game.score != null).sort((a, b) => a.round - b.round),
    }))
    .filter((row) => row.games.length > 0);
}

export type Streaks = {
  longestWin: number;
  current: { result: "win" | "draw" | "loss"; length: number } | null;
};

/** Win streaks over played games in order; forfeits and byes neither extend nor break a streak. */
export function streaksOf(games: Game[]): Streaks {
  const played = games.filter(isPlayed);
  let longestWin = 0;
  let run = 0;
  for (const game of played) {
    run = game.result === "win" ? run + 1 : 0;
    longestWin = Math.max(longestWin, run);
  }
  const last = played.at(-1);
  if (!last || last.result === "unknown") return { longestWin, current: null };
  let length = 0;
  for (let index = played.length - 1; index >= 0 && played[index].result === last.result; index -= 1) length += 1;
  return { longestWin, current: { result: last.result, length } };
}

/**
 * Results against opponents who finished the tournament with more, equal or fewer points.
 * A fair strength measure without ratings, which this page deliberately does not highlight.
 */
export function strengthSplit(tournaments: Tournament[]): { above: Tally; equal: Tally; below: Tally } {
  const above: Game[] = [];
  const equal: Game[] = [];
  const below: Game[] = [];
  for (const tournament of tournaments) {
    if (tournament.points == null) continue;
    for (const game of tournament.games) {
      if (game.opponentPoints == null) continue;
      const diff = game.opponentPoints - (tournament.points ?? 0);
      (Math.abs(diff) < 0.01 ? equal : diff > 0 ? above : below).push(game);
    }
  }
  return { above: recordOf(above), equal: recordOf(equal), below: recordOf(below) };
}

/** First half of each tournament's rounds against the second half. */
export function halvesSplit(tournaments: Tournament[]): { first: Tally; second: Tally } {
  const first: Game[] = [];
  const second: Game[] = [];
  for (const tournament of tournaments) {
    const rounds = tournament.roundsScheduled ?? Math.max(0, ...tournament.games.map((game) => game.round));
    if (rounds < 2) continue;
    for (const game of tournament.games) (game.round <= Math.ceil(rounds / 2) ? first : second).push(game);
  }
  return { first: recordOf(first), second: recordOf(second) };
}

/** Games on the first quarter of the boards (where the leaders play) against the rest. */
export function boardSplit(tournaments: Tournament[]): { top: Tally; rest: Tally } {
  const top: Game[] = [];
  const rest: Game[] = [];
  for (const tournament of tournaments) {
    if (!tournament.fieldSize || tournament.fieldSize < 8) continue;
    const topBoards = Math.max(1, Math.ceil(Math.ceil(tournament.fieldSize / 2) / 4));
    for (const game of tournament.games) {
      if (game.board > 0) (game.board <= topBoards ? top : rest).push(game);
    }
  }
  return { top: recordOf(top), rest: recordOf(rest) };
}

export type ClassStep = {
  label: string;
  from: string;
  to: string;
  tournaments: number;
  points: number;
  rounds: number;
  bestRank: number | null;
  bestField: number | null;
};

/** Consecutive tournaments of the same sports class, oldest first. */
export function classProgress(tournaments: Tournament[]): ClassStep[] {
  const steps: ClassStep[] = [];
  for (const tournament of [...tournaments].sort(byDate)) {
    if (tournament.points == null) continue;
    const label = sportClass(tournament) ?? "Bez klases";
    let step = steps.at(-1);
    if (!step || step.label !== label) {
      step = { label, from: tournament.startDate || tournament.endDate, to: tournament.endDate, tournaments: 0, points: 0, rounds: 0, bestRank: null, bestField: null };
      steps.push(step);
    }
    step.to = tournament.endDate || step.to;
    step.tournaments += 1;
    step.points += tournament.points;
    step.rounds += tournament.roundsScheduled ?? tournament.games.filter((game) => game.score != null).length;
    if (tournament.rank && (step.bestRank == null || tournament.rank < step.bestRank)) {
      step.bestRank = tournament.rank;
      step.bestField = tournament.fieldSize;
    }
  }
  return steps;
}

export function unplayedCounts(tournaments: Tournament[]): { forfeitWins: number; forfeitLosses: number; byes: number } {
  const games = tournaments.flatMap((tournament) => tournament.games);
  return {
    forfeitWins: games.filter((game) => game.unplayed === "forfeit" && game.result === "win").length,
    forfeitLosses: games.filter((game) => game.unplayed === "forfeit" && game.result === "loss").length,
    byes: games.filter((game) => game.unplayed === "bye").length,
  };
}
