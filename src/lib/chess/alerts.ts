import type { Dossier, NextGame } from "./types";

export const ALERT_KEY = "valters-alerts";
const SEEN_KEY = "valters-next-seen";

export function pairingKeys(dossier: Dossier): string[] {
  return dossier.tournaments.flatMap((tournament) => {
    const next = tournament.nextGame;
    if (!next) return [];
    return [pairingKey(tournament.id, next)];
  });
}

function pairingKey(tournamentId: string, next: NextGame): string {
  return [tournamentId, next.round, next.board, next.color, next.opponent].join("|");
}

export function shouldWatch(dossier: Dossier): boolean {
  return dossier.tournaments.some(
    (tournament) =>
      tournament.nextGame != null ||
      tournament.awaitingPairing ||
      tournament.endDate === dossier.today,
  );
}

export function freshPairings(previous: string | null, current: string[]): string[] {
  if (previous == null) return [];
  const seen = new Set(previous ? previous.split("\n") : []);
  return current.filter((key) => !seen.has(key));
}

export function rememberPairings(keys: string[]) {
  localStorage.setItem(SEEN_KEY, keys.join("\n"));
}

export function storedPairings(): string | null {
  return localStorage.getItem(SEEN_KEY);
}

export function pairingBody(key: string): string {
  const [, round, board, color, ...name] = key.split("|");
  const piece = color === "white" ? "baltie" : color === "black" ? "melnie" : "krāsa nav zināma";
  const table = board && board !== "0" ? `${board}. galds` : `${round}. kārta`;
  return `${table}, ${piece}. pret ${name.join("|")}`;
}

export async function showPairingNotification(body: string) {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  const title = "Nākamā partija";
  try {
    const ready = navigator.serviceWorker?.ready;
    const registration = ready ? await Promise.race([ready, timeout(1200)]) : null;
    if (registration && "showNotification" in registration) {
      await registration.showNotification(title, {
        body,
        lang: "lv",
        tag: "valters-next",
        icon: "/favicon.svg",
      });
    } else {
      new Notification(title, { body, lang: "lv" });
    }
  } catch {
    try {
      new Notification(title, { body, lang: "lv" });
    } catch {
      return;
    }
  }
  try {
    navigator.vibrate?.([200, 80, 200, 80, 280]);
  } catch {
    /* vibrate is optional */
  }
}

function timeout(ms: number): Promise<null> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(null), ms);
  });
}
