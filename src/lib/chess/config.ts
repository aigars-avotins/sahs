import type { SearchHit } from "./parse";

/** Everything specific to the one player this page follows. */
export const PLAYER = {
  displayName: "Valters Avotiņš",
  /** Name as chess-results writes it; used only if no search hit carries a name. */
  sourceName: "Avotins, Valters",
  fideId: "11662255",
};

/** Beginner tournaments where the player was entered without a FIDE ID, so the FIDE search misses them. */
export const EXTRA_TOURNAMENTS: SearchHit[] = [
  extra("1332728", "4", "V Chess Festival Cēsis 2026 - Turnīrs iesācējiem"),
  extra("1438074", "4", "SmartCup 2026 - I posms (D turnīrs - iesācēji)"),
  extra("1374865", "2", "Šahatons 2026- D"),
];

/** Places chess-results does not publish for these tournaments. */
export const EXTRA_PLACE: Record<string, string> = {
  "1332728": "Cēsis",
  "1374865": "Rīga",
};

/** Sports class shown on the tournament card when the name does not say it. */
export const SPORT_CLASS: Record<string, string> = {
  "1332728": "Iesācēji",
  "1374865": "Iesācēji",
  "1438074": "Iesācēji",
  "1465390": "4. sporta klase",
  "1487595": "4. sporta klase",
  "1465850": "3. sporta klase",
};

function extra(id: string, snr: string, tournamentName: string): SearchHit {
  return {
    id,
    snr,
    name: "Avotiņš, Valters",
    fideId: "0",
    club: "",
    fed: "LAT",
    tournamentName,
    endDate: "",
    rank: null,
    rounds: null,
    fieldSize: null,
    playerHref: `tnr${id}.aspx?lan=1&art=9&snr=${snr}`,
    tournamentHref: `tnr${id}.aspx?lan=1`,
  };
}
