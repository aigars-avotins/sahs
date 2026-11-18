import { test } from "node:test";
import assert from "node:assert/strict";
import { boardSplit, classProgress, halvesSplit, rateOf, recordOf, repeatOpponents, resultsByTournament, streaksOf, strengthSplit, unplayedCounts } from "../src/lib/chess/insights";
import type { Game, GameResult, Opponent, Tournament } from "../src/lib/chess/types";

const game = (round: number, result: GameResult, extra: Partial<Game> = {}): Game => ({
  round, board: round, opponent: `Op ${round}`, opponentTitle: "", opponentRating: null, opponentFed: "LAT", opponentClub: "",
  opponentPoints: null, result, resultRaw: "", score: result === "win" ? 1 : result === "draw" ? 0.5 : result === "loss" ? 0 : null,
  color: "white", tournamentId: "t", tournamentName: "T", tournamentDate: "", location: "", ...extra,
});
const tournament = (id: string, date: string, games: Game[], extra: Partial<Tournament> = {}): Tournament => ({
  id, name: `Turnīrs ${id}`, url: "", playerUrl: "", startDate: date, endDate: date, rank: 5, rounds: null, fieldSize: 20, club: "", fed: "",
  points: games.reduce((s, g) => s + (g.score ?? 0), 0), performance: null, startingRank: null, birthYear: "", location: "", timeControl: "",
  organizer: "", lastUpdate: "", roundsScheduled: games.length, partial: false, awaitingPairing: false, nextGame: null, standings: null, games, ...extra,
});

test("streaks run across tournaments in date order and skip forfeits", () => {
  const older = tournament("a", "2026-01-01", [game(1, "win"), game(2, "win")]);
  const newer = tournament("b", "2026-02-01", [game(1, "win", { unplayed: "forfeit", resultRaw: "+" }), game(2, "win"), game(3, "loss"), game(4, "loss")]);
  const games = resultsByTournament([newer, older]).flatMap((row) => row.games);
  assert.deepEqual(streaksOf(games), { longestWin: 3, current: { result: "loss", length: 2 } });
});

test("strength compares the opponent's final points with Valters' own", () => {
  const t = tournament("a", "2026-01-01", [
    game(1, "win", { opponentPoints: 2 }), game(2, "loss", { opponentPoints: 5 }), game(3, "draw", { opponentPoints: 1.5 }), game(4, "win", { opponentPoints: null }),
  ]); // points = 2.5
  const split = strengthSplit([t]);
  assert.deepEqual([split.above.losses, split.below.wins, split.below.draws, split.equal.games], [1, 1, 1, 0]);
});

test("halves, top boards, sports-class steps and unplayed counts", () => {
  const t = tournament("1332728", "2026-04-11", [game(1, "win"), game(2, "win"), game(3, "loss"), game(4, "loss", { board: 9 })], { fieldSize: 20 });
  const halves = halvesSplit([t]);
  assert.equal(rateOf(halves.first), 100); assert.equal(rateOf(halves.second), 0);
  const boards = boardSplit([t]); // 10 boards → top 3
  assert.deepEqual([boards.top.games, boards.rest.games], [3, 1]);
  const later = tournament("x", "2026-10-01", [game(1, "draw")], { name: "Kauss 4. sp. kl." });
  const steps = classProgress([later, t, tournament("y", "2026-12-01", [], { points: null })]);
  assert.deepEqual(steps.map((s) => [s.label, s.tournaments]), [["Iesācēji", 1], ["4. sporta klase", 1]]);
  const counts = unplayedCounts([tournament("z", "2026-01-01", [game(1, "win", { unplayed: "forfeit" }), game(2, "draw", { unplayed: "bye" })])]);
  assert.deepEqual(counts, { forfeitWins: 1, forfeitLosses: 0, byes: 1 });
  assert.equal(recordOf([game(1, "win", { unplayed: "bye" })]).games, 0);
});

test("repeat opponents are merged by name", () => {
  const op = (key: string, club: string, games: number): Opponent => ({ key, name: "Ozols, Pēteris", club, fed: "LAT", games, pending: 0, scored: games, wins: games, draws: 0, losses: 0, score: games, lastDate: "", lastTournament: "", lastLocation: "", lastResult: "win", meetings: [] });
  const merged = repeatOpponents([op("a", "Rīga", 1), op("b", "Cēsis", 1)]);
  assert.equal(merged.length, 1); assert.equal(merged[0].games, 2); assert.equal(merged[0].club, "Rīga · Cēsis");
});
