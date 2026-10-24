import { readFileSync } from "node:fs";
import { buildDossier, parsePlayerCard, parseSearchResults, parseTournamentMeta } from "../src/lib/chess/parse";
export const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), "utf8");
export function dossier() {
  return buildDossier({ hits: parseSearchResults(fixture("search")), cards: [parsePlayerCard(fixture("player-card"))], metas: [parseTournamentMeta(fixture("tournament"))], nextGames: [null], standings: [null], lastRoundAt: [""], today: "2026-10-24", fetchedAt: "2026-10-24T09:00:00Z", nextCheckAt: "2099-10-24T09:05:00Z", fideId: "11662255" });
}
