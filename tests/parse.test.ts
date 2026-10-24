import { test } from "node:test";
import assert from "node:assert/strict";
import { dayStatus, parsePlayerCard, parseRoundClock, parseRoundPairing, parseTournamentMeta, pendingGameFromCard, rigaToday } from "../src/lib/chess/parse";
import { paceOf, scopedDossier, scoreRate } from "../src/lib/chess/stats";
import { dossier, fixture } from "./helpers";

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
