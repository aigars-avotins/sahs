import { test } from "node:test";
import assert from "node:assert/strict";
import { dayStatus, isBye, parsePlayerCard, parseRoundClock, parseRoundDate, personName, rigaInstant, parseRoundPairing, parseTournamentMeta, pendingGameFromCard, rigaToday } from "../src/lib/chess/parse";
import { paceOf, scopedDossier, scoreRate } from "../src/lib/chess/stats";
import { dossier, fixture } from "./helpers";
import { buildDossier, parseSearchResults, parseTournamentMeta } from "../src/lib/chess/parse";

test("saved HTML: results, colors and FIDE identities survive extra row attributes", () => {
  const card = parsePlayerCard(fixture("player-card"));
  assert.equal(card.games.length, 3); assert.equal(card.games[0].opponentFideId, "12345678");
  assert.deepEqual(card.games.map(g => g.result), ["win", "draw", "unknown"]);
  assert.deepEqual(card.games.map(g => g.color), ["white", "black", "white"]);
  assert.equal(pendingGameFromCard(card, "tnr1.aspx")?.round, 3);
});
test("pending games never inflate played totals, opponent meetings or color rates", () => {
  const data = dossier(); assert.equal(data.totals.games, 2); assert.equal(data.totals.pending, 1);
  assert.equal(data.totals.score, 1.5); assert.equal(data.opponents.find(o => o.name.includes("Kalniņš"))?.games, 0);
  assert.equal(scoreRate(data.tournaments[0].games), 75);
  assert.equal(scoreRate(data.tournaments[0].games.filter(g => g.color === "white")), 100);
});
test("multi-day dates distinguish an active tournament from an upcoming one", () => {
  const meta = parseTournamentMeta(fixture("tournament"));
  assert.equal(meta.startDate, "2026-10-23"); assert.equal(meta.eventDate, "2026-10-25");
  assert.equal(dayStatus(meta.eventDate, "2026-10-24", meta.startDate), "live");
  assert.equal(dayStatus(meta.eventDate, "2026-10-22", meta.startDate), "upcoming");
  assert.equal(dayStatus(meta.eventDate, "2026-10-26", meta.startDate), "past");
});
test("round clock is the scheduled start, pairing maps white/black and pending state", () => {
  assert.equal(parseRoundClock(fixture("round")), "12:30");
  const white = parseRoundPairing(fixture("round"), "1", 3, "https://chess-results.com/tnr1.aspx");
  assert.equal(white?.color, "white"); assert.equal(white?.opponent, "Kalniņš, Roberts"); assert.equal(white?.pending, true);
  assert.equal(parseRoundPairing(fixture("round"), "2", 3, "url")?.color, "black");
});
test("challenge/changed HTML is rejected rather than accepted as an empty history", () => {
  assert.throws(() => parsePlayerCard("<html><title>Access denied</title></html>"));
  assert.throws(() => parseTournamentMeta("<html><title>Access denied</title></html>"));
});
test("shared filter scope changes all totals and opponents consistently", () => {
  const data = scopedDossier(dossier(), []); assert.equal(data.totals.games, 0); assert.equal(data.opponents.length, 0);
  assert.equal(paceOf("Blitz 5 min + 3 sec"), "blitz"); assert.equal(paceOf("15 min + 10 sec"), "rapid");
  assert.equal(paceOf("90 min + 30 sec"), "classical"); assert.equal(paceOf(""), "unknown");
});
test("Riga midnight is independent of server timezone", () => {
  assert.equal(rigaToday(new Date("2026-10-23T22:00:00Z")), "2026-10-24");
});
test("an intact player heading cannot hide a missing nonempty game table",()=>{
  const html=fixture("player-card").replace(/<table>\s*<tr data-test[\s\S]*?<\/table>/,"<table>changed layout</table>");
  assert.throws(()=>parsePlayerCard(html), /Partiju tabula/);
});
test("an archived tournament with deliberately hidden details still permits loading its games",()=>{
  const meta=parseTournamentMeta(fixture('archived-tournament'));
  assert.equal(meta.detailsHidden,true);assert.equal(meta.eventDate,'');assert.equal(meta.roundsScheduled,null);
  assert.throws(()=>parseTournamentMeta('<title>Unexpected proxy page</title>'));
});
test("FIDE pace boundaries: 10 min is blitz, 60 min is standard, plain minutes are not rapid", () => {
  assert.equal(paceOf("10 min"), "blitz"); assert.equal(paceOf("11 min"), "rapid");
  assert.equal(paceOf("50 min + 10 sec"), "classical"); assert.equal(paceOf("60 min"), "classical");
  assert.equal(paceOf("90 minutes + 30 seconds"), "classical");
});
test("a year/pace filter keeps opponent game counts to played games only", () => {
  const data = dossier(); const scoped = scopedDossier(data, data.tournaments);
  assert.equal(scoped.opponents.find(o => o.name.includes("Kalniņš"))?.games, 0);
  assert.equal(scoped.opponents.find(o => o.name.includes("Kalniņš"))?.pending, 1);
  assert.deepEqual(scoped.totals, data.totals);
});
test("bye names are recognized in every source language", () => {
  for (const name of ["brīvs", "bye", " Spielfrei "]) assert.equal(isBye(name), true);
  assert.equal(isBye("Byers, Anna"), false);
});
test("round start is read with its date and converted from Riga time", () => {
  assert.equal(parseRoundDate(fixture("round")), "2026-10-24");
  assert.equal(rigaInstant("2026-10-24", "12:30"), Date.parse("2026-10-24T09:30:00Z"));
  assert.equal(rigaInstant("2026-12-24", "12:30"), Date.parse("2026-12-24T10:30:00Z"));
  assert.equal(rigaInstant("2026-10-24", ""), null);
  assert.equal(personName("Kalniņš, Roberts Aleksandrs"), "Roberts Aleksandrs Kalniņš");
  assert.equal(personName("bye"), "bye");
});
test("a tournament without any result yet has no place and no points", () => {
  const card = parsePlayerCard(fixture("player-card"));
  card.games = card.games.map(g => ({ ...g, result: "unknown" as const, score: null, resultRaw: "" }));
  const data = buildDossier({ hits: parseSearchResults(fixture("search")), cards: [card], metas: [parseTournamentMeta(fixture("tournament"))], nextGames: [null], standings: [null], today: "2026-10-20", fetchedAt: "2026-10-20T09:00:00Z", fideId: "11662255" });
  assert.equal(data.tournaments[0].rank, null); assert.equal(data.tournaments[0].points, null);
  assert.equal(data.totals.tournaments, 0); assert.equal(data.totals.bestRank, null);
});
test("forfeits keep their points but are not played games; byes are not opponents", () => {
  const card = parsePlayerCard(fixture("player-card"));
  card.games[0] = { ...card.games[0], resultRaw: "+", result: "win", score: 1 };
  card.games[1] = { ...card.games[1], opponent: "bye", resultRaw: "½", result: "draw", score: 0.5 };
  const data = buildDossier({ hits: parseSearchResults(fixture("search")), cards: [card], metas: [parseTournamentMeta(fixture("tournament"))], nextGames: [null], standings: [null], today: "2026-10-24", fetchedAt: "2026-10-24T09:00:00Z", fideId: "11662255" });
  assert.equal(data.tournaments[0].games[0].unplayed, "forfeit"); assert.equal(data.tournaments[0].games[1].unplayed, "bye");
  assert.equal(data.totals.games, 0); assert.equal(data.totals.wins, 0); assert.equal(data.totals.tournaments, 1);
  assert.equal(data.opponents.some(o => o.name === "bye"), false);
  const forfeited = data.opponents.find(o => o.meetings.some(g => g.unplayed === "forfeit"));
  assert.equal(forfeited?.games, 0); assert.equal(forfeited?.wins, 0);
  assert.equal(scoreRate(data.tournaments[0].games), null);
});
