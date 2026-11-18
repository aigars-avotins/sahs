import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bell,
  BellRing,
  ChevronDown,
  ExternalLink,
  MapPin,
  RefreshCw,
  Search,
  Sun,
  Moon,
  Copy,
  Trophy,
} from "lucide-react";
import { Knight } from "@/components/knight";
import {
  ALERT_KEY,
  freshPairings,
  pairingBody,
  pairingKeys,
  rememberPairings,
  shouldWatch,
  showPairingNotification,
  storedPairings,
  unlockSound,
} from "@/lib/chess/alerts";
import { PLAYER, SPORT_CLASS } from "@/lib/chess/config";
import { getDossier } from "@/lib/chess/dossier";
import {
  boardSplit,
  classProgress,
  filterTournaments,
  halvesSplit,
  rateOf,
  recordOf,
  repeatOpponents,
  resultsByTournament,
  sportClass,
  streaksOf,
  strengthSplit,
  tournamentYears,
  unplayedCounts,
  type PaceFilter,
  type Streaks,
  type Tally,
} from "@/lib/chess/insights";
import {
  dayStatus,
  foldName,
  formatDate,
  formatPoints,
  formatStamp,
  isBye,
  isPlayed,
  isoDate,
  personName,
  rigaInstant,
} from "@/lib/chess/parse";
import { paceOf, scopedDossier, scoreRate } from "@/lib/chess/stats";
import { safeStorage } from "@/lib/storage";
import type { Dossier, Game, GameResult, LoadResult, NextGame, Opponent, OpponentGlance, PieceColor, Tournament } from "@/lib/chess/types";

const DISPLAY_NAME = PLAYER.displayName;

function freshnessLabel(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "nav zināms";
  const mins = Math.max(0, Math.round((now - then) / 60_000));
  if (mins < 1) return "tikko";
  if (mins < 60) return `pirms ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `pirms ${hours} h`;
  return `pirms ${Math.floor(hours / 24)} d`;
}

function pointsLabel(value: number | null): string {
  const shown = formatPoints(value);
  if (value == null || !Number.isFinite(value)) return shown;
  const whole = Math.floor(value + 1e-9);
  const fraction = value - whole;
  const half = Math.abs(fraction - 0.5) < 0.01 && whole === 0;
  const one = Math.abs(fraction) < 0.01 && whole === 1;
  return `${shown} ${half || one ? "punkts" : "punkti"}`;
}

function tidyTournamentName(name: string): string {
  return name
    .replace(/\(\s*\)/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.:;])/g, "$1")
    .trim();
}

function displayTournamentName(name: string, endDate: string): string {
  let next = name;
  if (endDate) {
    const iso = endDate.slice(0, 10);
    const parts = iso.split("-");
    if (parts.length >= 3) {
      const [year, month, day] = parts;
      const forms = [
        formatDate(iso),
        iso,
        `${year}/${month}/${day}`,
        `${day}.${month}.${year}`,
        `${day}.${month}.${year.slice(2)}`,
      ];
      for (const form of forms) {
        if (form && next.includes(form)) next = next.replace(form, " ");
      }
    }
  }
  return tidyTournamentName(next);
}

function statusClass(label: string | null): string {
  if (label === "Notiek") return "bg-pine text-white";
  return "bg-bg-deep text-muted";
}

function eventLabel(tournament: Tournament, today: string): string | null {
  if (tournament.nextGame || tournament.awaitingPairing) return "Notiek";
  if (!tournament.endDate) return null;
  const status = dayStatus(tournament.endDate, today) as string;
  if (status === "today" || status === "live") return "Notiek";
  if (status === "upcoming") return "Gaidāms";
  if (status === "past") return "Noslēdzies";
  return null;
}

function maxPoints(tournament: Tournament): { value: number; playedOnly: boolean } | null {
  if (tournament.roundsScheduled && tournament.roundsScheduled > 0) {
    return { value: tournament.roundsScheduled, playedOnly: false };
  }
  const scored = tournament.games.filter((game) => game.score != null).length;
  return scored > 0 ? { value: scored, playedOnly: true } : null;
}

type PageTab = "now" | "all" | "opponents" | "stats";

const PAGE_TABS: { id: PageTab; label: string }[] = [
  { id: "now", label: "Aktuālais" },
  { id: "all", label: "Turnīri" },
  { id: "opponents", label: "Pretinieki" },
  { id: "stats", label: "Statistika" },
];

type AlertState = {
  enabled: boolean;
  note: string;
  toggle: () => void;
};

function usePairingAlerts(dossier: Dossier | null, refreshQuiet: () => Promise<void>): AlertState {
  const [enabled, setEnabled] = useState(false);
  const [note, setNote] = useState("");
  const signature = dossier ? pairingKeys(dossier).join("\n") : "";
  const watching = dossier ? shouldWatch(dossier) : false;

  useEffect(() => {
    if (typeof window === "undefined" || typeof Notification === "undefined") return;
    setEnabled(safeStorage.get(ALERT_KEY) === "1" && Notification.permission === "granted");
  }, []);

  useEffect(() => {
    if (!enabled || !watching) return;
    const id = window.setInterval(() => {
      void refreshQuiet();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [enabled, watching, refreshQuiet]);

  useEffect(() => {
    if (!enabled || !dossier) return;
    const current = pairingKeys(dossier);
    const fresh = freshPairings(storedPairings(), current);
    if (storedPairings() == null) {
      rememberPairings(current);
      return;
    }
    rememberPairings(current);
    for (const key of fresh) void showPairingNotification(pairingBody(key));
  }, [enabled, signature, dossier]);

  async function toggle() {
    if (enabled) {
      safeStorage.remove(ALERT_KEY);
      setEnabled(false);
      setNote("Paziņojumi izslēgti.");
      return;
    }
    if (typeof Notification === "undefined") {
      setNote("Šis pārlūks nepaziņo. Atver Chrome vai pievieno lapu iPhone sākuma ekrānam.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      safeStorage.remove(ALERT_KEY);
      setEnabled(false);
      setNote("Paziņojumi ir bloķēti. Atļauj tos pārlūka iestatījumos.");
      return;
    }
    try {
      if ("serviceWorker" in navigator) await navigator.serviceWorker.register("/sw.js");
    } catch {
      /* page notification still works */
    }
    safeStorage.set(ALERT_KEY, "1");
    unlockSound();
    if (dossier) rememberPairings(pairingKeys(dossier));
    setEnabled(true);
    setNote("Ieslēgts. Kamēr lapa ir atvērta, telefons paziņos par jaunu pretinieku.");
  }

  return { enabled, note, toggle };
}

export function ValtersPending() {
  return (
    <Shell>
      <div className="mx-auto flex min-h-[70vh] max-w-3xl flex-col justify-center px-5 py-16">
        <p className="text-sm font-medium tracking-wide text-pine uppercase">Šaha asistents</p>
        <div className="mt-4 flex items-center gap-4">
          <Knight tone="white" className="size-16 rounded-xl bg-pine p-1" />
          <h1 className="text-4xl text-ink">{DISPLAY_NAME}</h1>
        </div>
        <p className="mt-4 max-w-md text-lg text-muted">Nolasa turnīrus un partijas no chess-results.com.</p>
      </div>
    </Shell>
  );
}

export function ValtersApp({ initial }: { initial: LoadResult }) {
  const [result, setResult] = useState(initial);
  const [loading, setLoading] = useState(false);

  const refreshQuiet = useCallback(async () => {
    try {
      setResult(await getDossier());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Neizdevās atjaunot.";
      setResult((current) =>
        current.ok
          ? { ...current, stale: true, warning: message }
          : { ok: false, error: message },
      );
    }
  }, []);

  async function refresh() {
    setLoading(true);
    try {
      await refreshQuiet();
    } finally {
      setLoading(false);
    }
  }

  const alerts = usePairingAlerts(result.ok ? result.dossier : null, refreshQuiet);
  const [tab, setTab] = useState<PageTab>("now");
  // Assume the next-game card is on screen at load; its observer corrects this right away.
  const [bannerInView, setBannerInView] = useState(true);
  if (!result.ok) {
    return (
      <Shell>
        <div className="mx-auto max-w-xl px-5 py-20">
          <p className="text-sm font-medium text-pine">chess-results.com</p>
          <h1 className="mt-2 text-4xl">{DISPLAY_NAME}</h1>
          <p className="mt-4 text-lg text-muted">{result.error}</p>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-pine px-5 font-medium text-white disabled:opacity-60"
          >
            <RefreshCw className={loading ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} />
            Mēģināt vēlreiz
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <TopBar
        dossier={result.dossier}
        loading={loading}
        onRefresh={refresh}
        tab={tab}
        onTab={setTab}
        dockFloating={tab === "now"}
        dockHidden={bannerInView}
      />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {result.warning ? (
          <p className="mb-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-brass">
            {result.warning}
          </p>
        ) : null}
        {result.dossier.partialNote ? (
          <p className="mb-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">
            {result.dossier.partialNote}
          </p>
        ) : null}
        {tab === "now" ? <CurrentView dossier={result.dossier} alerts={alerts} onBannerVisible={setBannerInView} /> : null}
        {tab === "all" ? <Board dossier={result.dossier} part="tournaments" /> : null}
        {tab === "opponents" ? <Board dossier={result.dossier} part="opponents" /> : null}
        {tab === "stats" ? <StatsView dossier={result.dossier} /> : null}
      </main>
      <footer className="mx-auto max-w-6xl px-4 pt-4 pb-10 text-sm text-muted sm:px-6">
        Dati tikai no{" "}
        <a className="underline decoration-line underline-offset-4" href="https://chess-results.com/" target="_blank" rel="noreferrer">
          chess-results.com
        </a>
        . Atsvaidzini turnīra laikā ar pogu Atjaunot. Atjaunots {formatStamp(result.dossier.fetchedAt)}.
      </footer>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  return (
    <div data-hydrated={hydrated ? "true" : "false"} className="relative z-0 min-h-screen overflow-x-clip text-ink">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url(/bg.jpg)" }}
      />
      <div aria-hidden className="page-veil pointer-events-none fixed inset-0 -z-10" />
      <div className="h-1 bg-pine" />
      {children}
    </div>
  );
}

function useNow(stepMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), stepMs);
    return () => window.clearInterval(id);
  }, [stepMs]);
  return now;
}

function TopBar({
  dossier,
  loading,
  onRefresh,
  tab,
  onTab,
  dockFloating,
  dockHidden,
}: {
  dossier: Dossier;
  loading: boolean;
  onRefresh: () => void;
  tab: PageTab;
  onTab: (tab: PageTab) => void;
  /** On Aktuālais the dock overlays the page and appears only once the next-game card scrolls away. */
  dockFloating: boolean;
  dockHidden: boolean;
}) {
  const [dark, setDark] = useState(false);
  const [compact, setCompact] = useState(false);
  const now = useNow();
  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark");
    // Hysteresis: shrinking the header moves the page, which must not flip it back.
    const onScroll = () => setCompact((current) => (current ? window.scrollY > 8 : window.scrollY > 64));
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    // Follow the phone's light/dark switch live, unless a theme was picked here.
    const system = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onSystem = (event: MediaQueryListEvent) => {
      const picked = safeStorage.get("valters-theme");
      if (picked === "dark" || picked === "light") return;
      if (event.matches) document.documentElement.dataset.theme = "dark";
      else delete document.documentElement.dataset.theme;
      setDark(event.matches);
    };
    system?.addEventListener("change", onSystem);
    return () => {
      window.removeEventListener("scroll", onScroll);
      system?.removeEventListener("change", onSystem);
    };
  }, []);
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "dark" ? "" : "dark";
    if (next) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    safeStorage.set("valters-theme", next ? "dark" : "light");
    setDark(Boolean(next));
  }
  const live = dossier.tournaments.find((tournament) => tournament.nextGame);
  const fresh = freshnessLabel(dossier.fetchedAt, now);
  const stamped = formatStamp(dossier.fetchedAt);
  const dockAway = dockFloating && dockHidden;
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white/95">
      <div className={"mx-auto max-w-6xl px-4 sm:px-6 " + (compact ? "py-2" : "pt-2 pb-3")}>
        <div
          className={
            "grid grid-cols-[auto_minmax(0,1fr)_auto] items-stretch gap-x-3 " +
            (compact ? "h-9 grid-rows-1" : "h-11 grid-rows-[minmax(0,1fr)_auto] sm:h-14")
          }
        >
          <button
            type="button"
            onClick={() => window.location.reload()}
            aria-label="Pārlādēt un atvērt aktuālo turnīru"
            className={
              "inline-flex shrink-0 items-center justify-center self-center rounded-lg bg-pine " +
              (compact ? "size-9" : "row-span-2 size-11 sm:size-14")
            }
          >
            <Knight tone="white" className={compact ? "size-8 p-0.5" : "size-10 p-0.5 sm:size-12"} />
          </button>
          <h1
            className={
              "min-w-0 truncate leading-none " + (compact ? "self-center text-xl" : "self-start text-2xl sm:text-3xl")
            }
          >
            {DISPLAY_NAME}
          </h1>
          <div className={"flex w-full shrink-0 justify-end gap-2 " + (compact ? "items-center self-center" : "items-start self-start")}>
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              aria-busy={loading}
              aria-label={loading ? "Atjauno" : "Atjaunot"}
              className="inline-flex h-8 items-center gap-2 rounded-full bg-pine px-2.5 text-sm font-medium text-white disabled:opacity-60 sm:px-4"
            >
              <RefreshCw className={loading ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} />
              <span className="hidden sm:inline">{loading ? "Atjauno…" : "Atjaunot"}</span>
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              aria-pressed={dark}
              aria-label={dark ? "Gaišā tēma" : "Tumšā tēma"}
              className="inline-flex size-8 items-center justify-center rounded-full border border-line bg-surface"
            >
              {dark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
            </button>
          </div>
          {compact ? null : (
            <>
              <p className="min-w-0 self-end truncate text-[13px] leading-none text-muted sm:text-sm">
                FIDE {dossier.player.fideId}
                {dossier.player.club ? ` · ${dossier.player.club}` : ""}
              </p>
              <p
                className="self-end whitespace-nowrap text-right text-xs leading-none text-muted"
                suppressHydrationWarning
                title={stamped ? `Atjaunots ${stamped}` : undefined}
              >
                {loading ? (
                  "Notiek"
                ) : (
                  <>
                    <span className="hidden sm:inline">Atjaunots </span>
                    {fresh}
                  </>
                )}
              </p>
            </>
          )}
        </div>
      </div>
      {live ? (
        <div
          className={
            dockFloating
              ? "absolute inset-x-0 top-full transition-opacity motion-reduce:transition-none " +
                (dockAway ? "pointer-events-none opacity-0" : "opacity-100")
              : ""
          }
          inert={dockAway}
        >
          <LiveDock dossier={dossier} tournament={live} />
        </div>
      ) : null}
      <nav aria-label="Sadaļas" className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 sm:px-4">
        {PAGE_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={tab === item.id ? "page" : undefined}
            onClick={() => onTab(item.id)}
            className={
              "h-11 shrink-0 border-b-2 px-3 text-sm font-medium " +
              (tab === item.id ? "border-pine text-ink" : "border-transparent text-muted")
            }
          >
            {item.label}
          </button>
        ))}
      </nav>
    </header>
  );
}

function AlertButton({ alerts, onPine = false }: { alerts: AlertState; onPine?: boolean }) {
  const look = onPine
    ? alerts.enabled
      ? "border border-white/40 text-white"
      : "bg-white text-pine"
    : alerts.enabled
      ? "border border-pine bg-white text-pine"
      : "border border-line bg-surface";
  return (
    <div className="grid justify-items-start gap-1">
      <button
        type="button"
        onClick={() => void alerts.toggle()}
        aria-pressed={alerts.enabled}
        className={"inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-medium " + look}
      >
        {alerts.enabled ? <BellRing className="size-4" aria-hidden /> : <Bell className="size-4" aria-hidden />}
        {alerts.enabled ? "Paziņojumi ieslēgti" : "Paziņot telefonā"}
      </button>
      {alerts.note ? <p className={"text-sm " + (onPine ? "text-on-pine" : "text-muted")}>{alerts.note}</p> : null}
    </div>
  );
}

function Overview({ alerts, dossier, withAlerts }: { alerts: AlertState; dossier: Dossier; withAlerts: boolean }) {
  return (
    <section className="flex flex-wrap items-start gap-x-3 gap-y-2">
      {withAlerts ? <AlertButton alerts={alerts} /> : null}
      <CopySummary dossier={dossier} />
      <details className="w-full">
        <summary className="cursor-pointer text-sm text-muted">Kā darbojas paziņojumi</summary>
        <p className="mt-1 max-w-xl text-sm text-muted">
          Ja ieslēgsi paziņojumus, telefons paziņos, kad chess-results publicēs nākamo pretinieku. Lapa jātur atvērta.
        </p>
      </details>
    </section>
  );
}

function CurrentView({
  dossier,
  alerts,
  onBannerVisible,
}: {
  dossier: Dossier;
  alerts: AlertState;
  onBannerVisible: (visible: boolean) => void;
}) {
  const live = liveTournaments(dossier);
  const shown = live.length > 0 ? live : quietTournaments(dossier);
  return (
    <div className="grid gap-4">
      <NextGames dossier={dossier} alerts={alerts} onBannerVisible={onBannerVisible} />
      {shown.length === 0 ? (
        <Empty>Turnīru vēl nav.</Empty>
      ) : (
        shown.map((tournament) => (
          <TournamentCard
            key={tournament.id}
            dossier={dossier}
            tournament={tournament}
            games={tournament.games}
            today={dossier.today}
            startOpen={live.length > 0 || tournament.points != null}
            featured
          />
        ))
      )}
      {/* The alert switch lives on the live cards; repeat it here only when there are none. */}
      <Overview alerts={alerts} dossier={dossier} withAlerts={live.length === 0} />
    </div>
  );
}

function NextGames({
  dossier,
  alerts,
  onBannerVisible,
}: {
  dossier: Dossier;
  alerts: AlertState;
  onBannerVisible: (visible: boolean) => void;
}) {
  const cards = liveTournaments(dossier);
  // The header dock mirrors the first tournament with a pairing, so only its card reports visibility.
  const docked = dossier.tournaments.find((tournament) => tournament.nextGame)?.id;
  if (cards.length === 0) return null;
  return (
    <div className="grid gap-3">
      {cards.map((tournament) =>
        tournament.nextGame ? (
          <NextGameBanner
            key={tournament.id}
            dossier={dossier}
            tournament={tournament}
            alerts={alerts}
            onVisible={tournament.id === docked ? onBannerVisible : undefined}
          />
        ) : (
          <LiveStatus key={tournament.id} tournament={tournament} alerts={alerts} />
        ),
      )}
    </div>
  );
}

/** Between tournaments: the nearest upcoming one and the latest with results. */
function quietTournaments(dossier: Dossier): Tournament[] {
  const upcoming = dossier.tournaments
    .filter((tournament) => dayStatus(tournament.endDate, dossier.today, tournament.startDate) === "upcoming")
    .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0))[0];
  const latest = dossier.tournaments.find(
    (tournament) => tournament !== upcoming && dayStatus(tournament.endDate, dossier.today, tournament.startDate) === "past",
  );
  const shown = [upcoming, latest].filter((tournament): tournament is Tournament => Boolean(tournament));
  return shown.length ? shown : dossier.tournaments.slice(0, 1);
}

function countdownLabel(next: NextGame, now: number): string {
  if (!next.startsOn || !next.startsAt) return "";
  const start = rigaInstant(next.startsOn, next.startsAt);
  if (start == null) return "";
  const minutes = Math.ceil((start - now) / 60_000);
  if (minutes <= 0) return minutes > -300 ? "sākusies" : "";
  if (minutes < 60) return `pēc ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return `pēc ${hours} h${rest ? ` ${rest} min` : ""}`;
  return `pēc ${Math.floor(hours / 24)} d`;
}

function Fact({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-sm text-on-pine">{label}</dt>
      <dd className="mt-1 flex h-14 items-end font-display leading-none tabular-nums">{children}</dd>
      {note ? (
        <dd className="mt-1 text-sm font-medium" suppressHydrationWarning>
          {note}
        </dd>
      ) : null}
    </div>
  );
}

function ColorSquare({ color, className = "" }: { color: PieceColor; className?: string }) {
  if (color === "unknown") return null;
  return (
    <span className={`grid size-9 shrink-0 place-items-center rounded-md bg-piece ${className}`}>
      <Knight tone={color === "white" ? "white" : "black"} className="size-8" />
    </span>
  );
}

function NextGameBanner({
  dossier,
  tournament,
  alerts,
  onVisible,
}: {
  dossier: Dossier;
  tournament: Tournament;
  alerts: AlertState;
  onVisible?: (visible: boolean) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const now = useNow();
  useEffect(() => {
    const node = ref.current;
    if (!node || !onVisible || typeof IntersectionObserver === "undefined") return;
    // The sticky header covers the top ~120px, so the card counts as visible only below it.
    const observer = new IntersectionObserver(([entry]) => onVisible(entry.isIntersecting), {
      rootMargin: "-120px 0px 0px 0px",
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      onVisible(false);
    };
  }, [onVisible]);
  const next = tournament.nextGame;
  if (!next) return null;
  const bye = isBye(next.opponent);
  const played = priorGames(dossier, next.opponent);
  const last = latestMeeting(played);
  const otherDay = next.startsOn && next.startsOn !== dossier.today ? formatDate(next.startsOn).slice(0, 6) : "";
  return (
    <section ref={ref} className="overflow-hidden rounded-2xl bg-pine text-white">
      <div className="grid sm:grid-cols-[8.5rem_1fr]">
        <div className="hidden place-items-center bg-white px-4 py-5 sm:grid">
          <MiniBoard color={next.color} />
        </div>
        <div className="px-5 py-5 sm:px-6">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium tracking-wide uppercase">Nākamā partija</p>
            <p className="text-sm tabular-nums">{next.round}. kārta</p>
          </div>
          <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-4">
            <Fact label="Galdiņš">
              <span className="text-6xl">{next.board > 0 ? next.board : "—"}</span>
            </Fact>
            <Fact label="Krāsa">
              <span className="inline-flex items-center gap-2">
                <ColorSquare color={next.color} className="sm:hidden" />
                <span className={next.color === "unknown" ? "text-xl" : "text-3xl"}>
                  {next.color === "unknown" ? "vēl nav zināma" : colorName(next.color)}
                </span>
              </span>
            </Fact>
            {next.startsAt ? (
              <Fact label="Sākums" note={countdownLabel(next, now)}>
                <span className="text-4xl">
                  {otherDay ? <span className="mr-2 text-2xl">{otherDay}</span> : null}
                  {next.startsAt}
                </span>
              </Fact>
            ) : null}
          </dl>
          <p className="mt-5 text-xl">
            {bye ? "Brīva kārta" : `pret ${personName(next.opponent)}${next.opponentTitle ? `, ${next.opponentTitle}` : ""}`}
          </p>
          {bye ? null : (
            <>
              <p className="mt-1 text-sm text-on-pine">
                {historyLine(played)}
                {next.opponentFed ? ` · ${next.opponentFed}` : ""}
              </p>
              {last ? (
                <p className="mt-1 text-sm text-on-pine">
                  Pēdējo reizi {formatDate(last.tournamentDate)}: {resultWord(last.result)},{" "}
                  {colorName(last.color).toLocaleLowerCase("lv")}
                  {last.tournamentName ? ` · ${last.tournamentName}` : ""}
                </p>
              ) : null}
              {next.glance ? <Glance glance={next.glance} /> : null}
            </>
          )}
          <p className="mt-1 text-sm text-on-pine">{placeLine(tournament)}</p>
          <Neighbors tournament={tournament} light />
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
            <AlertButton alerts={alerts} onPine />
            <a href={next.url} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 text-sm font-medium text-white">
              Izloze chess-results
              <ExternalLink className="size-4" aria-hidden />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function LiveStatus({ tournament, alerts }: { tournament: Tournament; alerts: AlertState }) {
  const played = new Set(tournament.games.filter((game) => game.score != null).map((game) => game.round)).size;
  const last = [...tournament.games].sort((a, b) => b.round - a.round)[0];
  const waiting = tournament.awaitingPairing;
  // Without a published round count we cannot claim the tournament is over.
  const finished = tournament.roundsScheduled != null && played >= tournament.roundsScheduled;
  return (
    <section className="rounded-2xl border border-line bg-surface px-5 py-4">
      <p className="text-sm font-medium tracking-wide text-pine uppercase">
        {waiting ? "Gaidām izlozi" : "Šodienas turnīrs"}
      </p>
      <p className="mt-2 text-lg">
        {waiting
          ? `Nākamā kārta vēl nav chess-results. Nospēlētas ${played}${tournament.roundsScheduled ? ` no ${tournament.roundsScheduled}` : ""} kārtām.`
          : finished
            ? `Visas ${tournament.roundsScheduled} kārtas ir nospēlētas. Nākamajā turnīrā te parādīsies galdiņš un krāsa.`
            : `${playedRounds(played)}${tournament.roundsScheduled ? ` no ${tournament.roundsScheduled}` : ". Kārtu skaits chess-results nav publicēts"}. Nākamā izloze parādīsies pēc atjaunošanas.`}
      </p>
      {last ? (
        <p className="mt-2 text-sm text-muted">
          Pēdējā: {last.round}. kārta
          {last.board > 0 ? `, ${last.board}. galds` : ""}, {colorName(last.color).toLocaleLowerCase("lv")}, pret{" "}
          {personName(last.opponent)}.
        </p>
      ) : null}
      <Neighbors tournament={tournament} />
      {finished && !alerts.enabled ? null : (
        <div className="mt-3">
          <AlertButton alerts={alerts} />
        </div>
      )}
    </section>
  );
}

function playedRounds(count: number): string {
  return count % 10 === 1 && count % 100 !== 11 ? `Nospēlēta ${count} kārta` : `Nospēlētas ${count} kārtas`;
}

function RoundNote({ dossier, tournament, featured }: { dossier: Dossier; tournament: Tournament; featured: boolean }) {
  const next = tournament.nextGame;
  // On Aktuālais the next-game card already says all of this.
  if (next && featured) return null;
  if (next) {
    const played = priorGames(dossier, next.opponent);
    const bye = isBye(next.opponent);
    return (
      <p className="mb-3 text-sm">
        Nākamā: {next.round}. kārta, {next.board > 0 ? `${next.board}. galds` : "galds vēl nav zināms"},{" "}
        {colorName(next.color).toLocaleLowerCase("lv")}
        {bye ? ", brīva kārta" : ` pret ${personName(next.opponent)}`}.
        {bye ? "" : ` ${historyLine(played)}.`}
        {next.startsAt ? ` Sākums ${next.startsAt}.` : ""}
      </p>
    );
  }
  if (tournament.awaitingPairing) {
    return <p className="mb-3 text-sm text-brass">Nākamā izloze vēl nav publicēta. Spied «Atjaunot».</p>;
  }
  return null;
}

function StatsView({ dossier }: { dossier: Dossier }) {
  const [year, setYear] = useState("all");
  const [pace, setPace] = useState<PaceFilter>("all");
  const years = useMemo(() => tournamentYears(dossier.tournaments), [dossier.tournaments]);
  const scoped = useMemo(() => {
    const tournaments = filterTournaments(dossier.tournaments, year, pace);
    return scopedDossier(dossier, tournaments);
  }, [dossier, year, pace]);
  const { totals } = scoped;
  const rows = useMemo(() => resultsByTournament(scoped.tournaments), [scoped.tournaments]);
  const ordered = useMemo(() => rows.flatMap((row) => row.games), [rows]);
  const rate = scoreRate(ordered);
  const recent = ordered.filter(isPlayed).slice(-10);
  const recentRate = scoreRate(recent);
  const streaks = streaksOf(ordered);
  const best = bestTournament(scoped.tournaments);
  const unplayed = unplayedCounts(scoped.tournaments);
  const summary = [
    tournamentCountLabel(totals.tournaments),
    `${totals.games} ${totals.games % 10 === 1 && totals.games % 100 !== 11 ? "partija" : "partijas"}`,
    `${totals.wins}–${totals.draws}–${totals.losses}`,
  ].join(" · ");
  const unplayedNote = [
    unplayed.forfeitWins ? `${unplayed.forfeitWins} ${unplayed.forfeitWins === 1 ? "uzvara" : "uzvaras"} bez spēles` : "",
    unplayed.forfeitLosses ? `${unplayed.forfeitLosses} ${unplayed.forfeitLosses === 1 ? "zaudējums" : "zaudējumi"} bez spēles` : "",
    unplayed.byes ? `${unplayed.byes} ${unplayed.byes === 1 ? "brīva kārta" : "brīvas kārtas"}` : "",
  ].filter(Boolean);
  return (
    // minmax(0, 1fr): long nowrap names inside must truncate instead of widening the page.
    <div className="grid grid-cols-1 gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <fieldset className="min-w-0">
          <legend className="mb-2 text-sm font-medium">Gads</legend>
          <div className="flex flex-wrap gap-2">
            <FilterChip pressed={year === "all"} onClick={() => setYear("all")}>
              Visi
            </FilterChip>
            {years.map((item) => (
              <FilterChip key={item} pressed={year === item} onClick={() => setYear(item)}>
                {item}
              </FilterChip>
            ))}
          </div>
        </fieldset>
        <fieldset className="min-w-0">
          <legend className="mb-2 text-sm font-medium">Temps</legend>
          <div className="flex flex-wrap gap-2">
            <FilterChip pressed={pace === "all"} onClick={() => setPace("all")}>
              Visi
            </FilterChip>
            <FilterChip pressed={pace === "rapid"} onClick={() => setPace("rapid")}>
              Rapids
            </FilterChip>
            <FilterChip pressed={pace === "other"} onClick={() => setPace("other")}>
              Citi
            </FilterChip>
          </div>
        </fieldset>
      </div>

      {ordered.length === 0 ? (
        <Empty>Šajā atlasē vēl nav partiju ar rezultātu.</Empty>
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <StatCard label="Punkti no iespējamajiem">
              <p className="mt-1 font-display text-6xl leading-none text-pine tabular-nums">{rate == null ? "—" : `${rate}%`}</p>
              <p className="mt-3 text-sm">{summary}</p>
              <p className="mt-1 text-xs text-muted">Uzvaras–neizšķirti–zaudējumi, tikai nospēlētās partijas.</p>
            </StatCard>
            <StatCard label="Forma">
              <p className="mt-1 font-display text-4xl leading-none text-pine tabular-nums">{recentRate == null ? "—" : `${recentRate}%`}</p>
              <p className="mt-2 text-sm">
                pēdējās {recent.length} partijās{rate != null && recentRate != null ? ` (kopā ${rate}%)` : ""}
              </p>
              <p className="mt-1 text-sm text-muted">
                Garākā uzvaru sērija: {streaks.longestWin}
                {streaks.current && streaks.current.length > 1 ? ` · tagad ${streakLabel(streaks.current)}` : ""}
              </p>
            </StatCard>
            <StatCard label="Labākais rezultāts">
              {best ? (
                <>
                  <p className="mt-1 font-display text-4xl leading-none text-pine tabular-nums">
                    {best.rank}. vieta
                    {best.fieldSize ? <span className="font-sans text-base text-muted"> no {best.fieldSize}</span> : null}
                  </p>
                  <p className="mt-2 text-sm">{displayTournamentName(best.name, best.endDate)}</p>
                  {best.endDate ? <p className="text-sm text-muted tabular-nums">{formatDate(best.endDate)}</p> : null}
                </>
              ) : (
                <p className="mt-3 text-sm text-muted">Vietas vēl nav publicētas.</p>
              )}
            </StatCard>
          </div>

          <ResultStrip rows={rows} />
          <TournamentRows tournaments={scoped.tournaments} />
          <div className="grid gap-3 lg:grid-cols-2">
            <ColorCard tournaments={scoped.tournaments} />
            <StrengthCard tournaments={scoped.tournaments} />
            <PhaseCard tournaments={scoped.tournaments} />
            <OpponentsCard opponents={scoped.opponents} />
          </div>
          <ClassSteps tournaments={scoped.tournaments} />
          {unplayedNote.length ? (
            <p className="text-sm text-muted">Statistikā neieskaitīts: {unplayedNote.join(", ")}. Turnīra punktos tās ir ieskaitītas.</p>
          ) : null}
        </>
      )}
    </div>
  );
}

function StatCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-white px-5 py-4">
      <p className="text-sm text-muted">{label}</p>
      {children}
    </div>
  );
}

function streakLabel(current: NonNullable<Streaks["current"]>): string {
  const many = current.length !== 1;
  if (current.result === "win") return `${current.length} ${many ? "uzvaras" : "uzvara"} pēc kārtas`;
  if (current.result === "draw") return `${current.length} ${many ? "neizšķirti" : "neizšķirts"} pēc kārtas`;
  return `${current.length} ${many ? "zaudējumi" : "zaudējums"} pēc kārtas`;
}

/** Best place; ties go to the larger field, then the more recent tournament. */
function bestTournament(tournaments: Tournament[]): Tournament | null {
  const placed = tournaments.filter((tournament) => tournament.rank != null && tournament.rank > 0);
  placed.sort(
    (a, b) =>
      (a.rank ?? 0) - (b.rank ?? 0) ||
      (b.fieldSize ?? 0) - (a.fieldSize ?? 0) ||
      (a.endDate < b.endDate ? 1 : a.endDate > b.endDate ? -1 : 0),
  );
  return placed[0] ?? null;
}

/** Every result of the season as a square, grouped by tournament; tapping one shows the game. */
function ResultStrip({ rows }: { rows: Array<{ tournament: Tournament; games: Game[] }> }) {
  const [picked, setPicked] = useState<string | null>(null);
  const all = rows.flatMap((row) => row.games);
  const game = all.find((item) => `${item.tournamentId}-${item.round}` === picked) ?? null;
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="text-xl">Visas partijas</h3>
      <p className="mt-1 text-sm text-muted">Vecākā kreisajā pusē. Pieskaries partijai, lai redzētu, pret ko.</p>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2">
        {rows.map((row) => (
          <ol key={row.tournament.id} className="flex flex-wrap gap-1" aria-label={displayTournamentName(row.tournament.name, row.tournament.endDate)}>
            {row.games.map((item) => {
              const id = `${item.tournamentId}-${item.round}`;
              const mark = stripMark(item);
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => setPicked((current) => (current === id ? null : id))}
                    aria-pressed={picked === id}
                    aria-label={`${item.round}. kārta pret ${item.opponent}: ${mark.name}`}
                    className={`grid size-8 place-items-center rounded-md text-xs font-medium tabular-nums ${mark.cls} ${picked === id ? "ring-2 ring-ink ring-offset-1" : ""}`}
                  >
                    {mark.label}
                  </button>
                </li>
              );
            })}
          </ol>
        ))}
      </div>
      <p className="mt-3 min-h-5 text-sm" aria-live="polite">
        {game
          ? `${formatDate(game.tournamentDate)} · ${game.tournamentName} · ${game.round}. kārta: ${colorName(game.color).toLocaleLowerCase("lv")} pret ${game.opponent} — ${stripMark(game).name.toLocaleLowerCase("lv")}`
          : ""}
      </p>
    </section>
  );
}

function stripMark(game: Game): { label: string; name: string; cls: string } {
  if (game.unplayed === "bye") return { label: formatPoints(game.score), name: "Brīva kārta", cls: "border border-line text-muted" };
  if (game.unplayed === "forfeit")
    return game.result === "win"
      ? { label: "+", name: "Uzvara bez spēles", cls: "border border-pine text-pine" }
      : { label: "−", name: "Zaudējums bez spēles", cls: "border border-loss text-loss" };
  if (game.result === "win") return { label: "1", name: "Uzvara", cls: "bg-pine text-white" };
  if (game.result === "draw") return { label: "½", name: "Neizšķirts", cls: "bg-bg-deep text-ink" };
  return { label: "0", name: "Zaudējums", cls: "bg-loss/15 text-loss" };
}

/** One row per tournament: place among the field as a bar, points out of the maximum. */
function TournamentRows({ tournaments }: { tournaments: Tournament[] }) {
  const rows = tournaments.filter((tournament) => tournament.points != null);
  if (rows.length === 0) return null;
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="text-xl">Turnīri</h3>
      <p className="mt-1 text-sm text-muted">Josla rāda vietu starp visiem dalībniekiem: jo garāka, jo augstāk.</p>
      <ol className="mt-3 grid grid-cols-1 gap-3">
        {rows.map((tournament) => {
          const cap = maxPoints(tournament);
          const share = cap && tournament.points != null ? Math.round((tournament.points / cap.value) * 100) : null;
          const field = tournament.fieldSize ?? 0;
          const standing = tournament.rank && field > 1 ? 1 - (tournament.rank - 1) / (field - 1) : null;
          const sport = sportClass(tournament);
          return (
            <li key={tournament.id} className="grid min-w-0 grid-cols-1 gap-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-medium">{displayTournamentName(tournament.name, tournament.endDate)}</p>
                <p className="shrink-0 text-sm tabular-nums">
                  {formatPoints(tournament.points)}
                  {cap ? `/${cap.value}` : ""}
                  {share != null ? <span className="text-muted"> · {share}%</span> : null}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-deep" aria-hidden>
                  {standing != null ? <div className="h-full rounded-full bg-chart" style={{ width: `${Math.max(4, standing * 100)}%` }} /> : null}
                </div>
                <p className="w-24 shrink-0 text-right text-xs text-muted tabular-nums">
                  {tournament.rank ? `${tournament.rank}. vieta${field ? ` no ${field}` : ""}` : "vieta nav zināma"}
                </p>
              </div>
              <p className="text-xs text-muted tabular-nums">
                {formatDate(tournament.endDate)}
                {sport ? ` · ${sport}` : ""}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** A labelled win/draw/loss bar with the score rate. */
function TallyRow({ label, tally }: { label: string; tally: Tally }) {
  const rate = rateOf(tally);
  const parts = [
    { value: tally.wins, cls: "bg-chart" },
    { value: tally.draws, cls: "bg-chart-soft" },
    { value: tally.losses, cls: "bg-loss" },
  ];
  return (
    <li>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0">{label}</span>
        <span className="shrink-0 tabular-nums">
          {tally.games ? `${tally.wins}–${tally.draws}–${tally.losses}` : "nav partiju"}
          {rate != null ? <span className="text-muted"> · {rate}%</span> : null}
        </span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-bg-deep" aria-hidden>
        {tally.games
          ? parts.map((part, index) =>
              part.value ? <div key={index} className={part.cls} style={{ width: `${(part.value / tally.games) * 100}%` }} /> : null,
            )
          : null}
      </div>
    </li>
  );
}

function TallyCard({ title, hint, rows }: { title: string; hint: string; rows: Array<{ label: string; tally: Tally }> }) {
  if (rows.every((row) => row.tally.games === 0)) return null;
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="text-xl">{title}</h3>
      <p className="mt-1 text-sm text-muted">{hint}</p>
      <ul className="mt-3 grid gap-3">
        {rows.map((row) => (
          <TallyRow key={row.label} label={row.label} tally={row.tally} />
        ))}
      </ul>
    </section>
  );
}

function ColorCard({ tournaments }: { tournaments: Tournament[] }) {
  const games = tournaments.flatMap((tournament) => tournament.games);
  return (
    <TallyCard
      title="Pēc krāsas"
      hint="Uzvaras–neizšķirti–zaudējumi un punktu procents ar katru krāsu."
      rows={[
        { label: "Baltie", tally: recordOf(games.filter((game) => game.color === "white")) },
        { label: "Melnie", tally: recordOf(games.filter((game) => game.color === "black")) },
      ]}
    />
  );
}

function StrengthCard({ tournaments }: { tournaments: Tournament[] }) {
  const split = strengthSplit(tournaments);
  return (
    <TallyCard
      title="Pret stiprākiem un vājākiem"
      hint="Pēc pretinieka punktiem tajā pašā turnīrā, salīdzinot ar Valtera punktiem."
      rows={[
        { label: "Ieguva vairāk punktu", tally: split.above },
        { label: "Tikpat punktu", tally: split.equal },
        { label: "Ieguva mazāk punktu", tally: split.below },
      ]}
    />
  );
}

function PhaseCard({ tournaments }: { tournaments: Tournament[] }) {
  const halves = halvesSplit(tournaments);
  const boards = boardSplit(tournaments);
  return (
    <TallyCard
      title="Turnīra gaitā"
      hint="Turnīra pirmā un otrā puse; augšējie galdi ir pirmā ceturtdaļa, kur spēlē līderi."
      rows={[
        { label: "Pirmā puse", tally: halves.first },
        { label: "Otrā puse", tally: halves.second },
        { label: "Augšējie galdi", tally: boards.top },
        { label: "Pārējie galdi", tally: boards.rest },
      ]}
    />
  );
}

function OpponentsCard({ opponents }: { opponents: Opponent[] }) {
  const top = repeatOpponents(opponents)
    .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name, "lv"))
    .slice(0, 3);
  if (top.length === 0) return null;
  return (
    <TallyCard
      title="Biežākie pretinieki"
      hint="Apvienoti pēc vārda un uzvārda."
      rows={top.map((opponent) => ({
        label: `${opponent.name} · ${opponent.games}×`,
        tally: { games: opponent.games, wins: opponent.wins, draws: opponent.draws, losses: opponent.losses, score: opponent.score },
      }))}
    />
  );
}

function ClassSteps({ tournaments }: { tournaments: Tournament[] }) {
  const steps = classProgress(tournaments);
  if (steps.length === 0) return null;
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="text-xl">Sporta klases</h3>
      <ol className="mt-3 grid gap-3 border-l-2 border-line pl-4">
        {steps.map((step, index) => (
          <li key={`${step.label}-${step.from}`} className="relative">
            <span
              aria-hidden
              className={"absolute top-1.5 -left-[1.4rem] size-3 rounded-full " + (index === steps.length - 1 ? "bg-pine" : "bg-line")}
            />
            <p className="font-medium">{step.label}</p>
            <p className="text-sm text-muted tabular-nums">
              {shortRange(step.from, step.to)} · {tournamentCountLabel(step.tournaments)} · {formatPoints(step.points)}
              {step.rounds ? `/${step.rounds}` : ""} punkti
              {step.bestRank ? ` · labākā vieta ${step.bestRank}.${step.bestField ? ` no ${step.bestField}` : ""}` : ""}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function shortRange(from: string, to: string): string {
  const a = formatDate(from).slice(0, 6);
  const b = formatDate(to).slice(0, 6);
  return a === b || !to ? formatDate(from) : `${a}–${formatDate(to)}`;
}

function matchesQuery(haystack: string, query: string): boolean {
  const words = foldName(query).split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = foldName(haystack);
  return words.every((word) => text.includes(word));
}

function Board({ dossier, part }: { dossier: Dossier; part: "tournaments" | "opponents" }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [year, setYear] = useState("all");
  const [pace, setPace] = useState<PaceFilter>("all");
  const [opponentSort, setOpponentSort] = useState<"games" | "name">("games");
  const needle = query.trim();
  const years = useMemo(() => tournamentYears(dossier.tournaments), [dossier.tournaments]);
  const scoped = useMemo(() => filterTournaments(dossier.tournaments, year, pace), [dossier.tournaments, year, pace]);

  const scopedOpponents = useMemo(
    () => (year === "all" && pace === "all" ? dossier.opponents : scopedDossier(dossier, scoped).opponents),
    [dossier, scoped, year, pace],
  );

  const tournaments = useMemo(() => {
    if (!needle) return scoped.map((tournament) => ({ tournament, games: tournament.games }));
    return scoped.flatMap((tournament) => {
      const about = [tournament.name, tournament.location, tournament.organizer, tournament.timeControl].join(" ");
      if (matchesQuery(about, needle)) return [{ tournament, games: tournament.games }];
      const games = tournament.games.filter((game) =>
        matchesQuery([game.opponent, game.opponentClub, game.opponentFed, game.location].join(" "), needle),
      );
      return games.length > 0 ? [{ tournament, games }] : [];
    });
  }, [scoped, needle]);

  const opponents = useMemo(() => {
    if (!needle) return scopedOpponents;
    return scopedOpponents.filter((opponent) =>
      matchesQuery(
        [
          opponent.name,
          opponent.club,
          opponent.fed,
          opponent.lastTournament,
          opponent.lastLocation,
          ...opponent.meetings.flatMap((game) => [game.tournamentName, game.location, game.opponentClub]),
        ].join(" "),
        needle,
      ),
    );
  }, [scopedOpponents, needle]);

  const repeats = useMemo(() => repeatOpponents(opponents), [opponents]);
  // Opponents met 2+ times are shown once, merged by name (most young players have no FIDE ID).
  const shownOpponents = useMemo(() => {
    const repeatNames = new Set(repeats.map((opponent) => foldName(opponent.name)));
    const once = opponents.filter((opponent) => !repeatNames.has(foldName(opponent.name)));
    return [...repeats, ...once].sort((a, b) =>
      opponentSort === "name"
        ? a.name.localeCompare(b.name, "lv")
        : b.games - a.games || a.name.localeCompare(b.name, "lv"),
    );
  }, [repeats, opponents, opponentSort]);

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <label className="flex h-14 items-center gap-3 rounded-full border border-line bg-white px-4">
          <Search className="size-5 text-muted" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={part === "tournaments" ? "Meklēt turnīru" : "Meklēt pretinieku vai klubu"}
            autoComplete="off"
            enterKeyHint="search"
            className="w-full bg-transparent text-base outline-none placeholder:text-muted"
          />
        </label>
        {part === "tournaments" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <fieldset className="min-w-0">
              <legend className="mb-2 text-sm font-medium">Gads</legend>
              <div className="flex flex-wrap gap-2">
                <FilterChip pressed={year === "all"} onClick={() => setYear("all")}>
                  Visi
                </FilterChip>
                {years.map((item) => (
                  <FilterChip key={item} pressed={year === item} onClick={() => setYear(item)}>
                    {item}
                  </FilterChip>
                ))}
              </div>
            </fieldset>
            <fieldset className="min-w-0">
              <legend className="mb-2 text-sm font-medium">Temps</legend>
              <div className="flex flex-wrap gap-2">
                <FilterChip pressed={pace === "all"} onClick={() => setPace("all")}>
                  Visi
                </FilterChip>
                <FilterChip pressed={pace === "rapid"} onClick={() => setPace("rapid")}>
                  Rapids
                </FilterChip>
                <FilterChip pressed={pace === "other"} onClick={() => setPace("other")}>
                  Citi
                </FilterChip>
              </div>
            </fieldset>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Kārtošana">
            <FilterChip pressed={opponentSort === "games"} onClick={() => setOpponentSort("games")}>
              Pēc partijām
            </FilterChip>
            <FilterChip pressed={opponentSort === "name"} onClick={() => setOpponentSort("name")}>
              Pēc vārda
            </FilterChip>
          </div>
        )}
        {needle ? (
          <p className="px-4 text-sm text-muted">
            {part === "tournaments"
              ? tournaments.length === 1
                ? "1 turnīrs"
                : `${tournaments.length} turnīri`
              : shownOpponents.length === 1
                ? "1 pretinieks"
                : `${shownOpponents.length} pretinieki`}
          </p>
        ) : null}
      </div>

      {part === "tournaments" ? (
        <section>
          <SectionTitle title="Turnīri" hint={`${tournaments.length} no ${dossier.tournaments.length}`} />
          {tournaments.length === 0 ? (
            <Empty>Nav turnīru, kas atbilst meklējumam.</Empty>
          ) : (
            <div className="grid gap-3">
              {tournaments.map(({ tournament, games }) => (
                <TournamentCard
                  key={tournament.id}
                  dossier={dossier}
                  tournament={tournament}
                  games={games}
                  today={dossier.today}
                  startOpen={Boolean(needle)}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
          {shownOpponents.length > 0 ? (
            <section>
              <SectionTitle title="Pretinieki" hint="" />
              <ul className="grid gap-1.5">
                {shownOpponents.map((opponent) => (
                  <li key={opponent.key}>
                    <OpponentRow
                      opponent={opponent}
                      pressed={opponent.key === selected}
                      onSelect={() => setSelected((current) => (current === opponent.key ? null : opponent.key))}
                    />
                    {opponent.key === selected ? <Meetings opponent={opponent} /> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <Empty>{needle ? "Nav pretinieku, kas atbilst meklējumam." : "Vēl nav pretinieku šajos turnīros."}</Empty>
          )}
        </>
      )}
    </div>
  );
}

function SectionTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-2xl">{title}</h2>
      {hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-muted">{children}</p>;
}

function MetaLine({ tournament }: { tournament: Tournament }) {
  const bits = [tournament.timeControl ? shortTime(tournament.timeControl) : "", tournament.organizer].filter(Boolean);
  if (bits.length === 0) return null;
  return <p className="mb-3 text-sm leading-snug text-muted">{bits.join(" · ")}</p>;
}

function TournamentCard({
  dossier,
  tournament,
  today,
  startOpen,
  games,
  featured = false,
}: {
  dossier: Dossier;
  tournament: Tournament;
  today: string;
  startOpen: boolean;
  games: Game[];
  featured?: boolean;
}) {
  const label = eventLabel(tournament, today);
  const sport = sportClass(tournament);
  const medal = tournament.rank != null && tournament.rank >= 1 && tournament.rank <= 3;
  const cap = maxPoints(tournament);
  const [opened, setOpened] = useState(startOpen);
  useEffect(() => {
    setOpened(startOpen);
  }, [startOpen]);
  return (
    <article className="min-w-0 rounded-2xl border border-line bg-surface">
      <details className="group" open={opened} onToggle={(event) => setOpened(event.currentTarget.open)}>
        <summary
          aria-expanded={opened}
          className="flex cursor-pointer list-none flex-col gap-3 rounded-2xl px-4 py-4 hover:bg-bg-deep sm:flex-row sm:items-center sm:px-5"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
              {label ? (
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(label)}`}>{label}</span>
              ) : null}
              {sport ? (
                <span className="rounded-full bg-bg-deep px-2 py-0.5 text-xs font-medium text-muted">{sport}</span>
              ) : null}
              {medal ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-pine-soft px-2 py-0.5 text-xs font-medium text-pine">
                  <Trophy className="size-3.5" aria-hidden />
                  {tournament.rank}. vieta
                </span>
              ) : null}
              </div>
              <ChevronDown className="ml-auto size-5 shrink-0 text-muted transition-transform group-open:rotate-180 sm:hidden" aria-hidden />
            </div>
            <h3 className={(featured ? "text-2xl" : "text-xl") + (label || sport || medal ? " mt-2" : "")}>
              {displayTournamentName(tournament.name, tournament.endDate)}
            </h3>
            <p className="mt-1 text-sm text-muted">
              {tournament.endDate ? <span className="tabular-nums">{formatDate(tournament.endDate)}</span> : null}
              {tournament.location ? (
                <span className="mt-1 flex items-start gap-1">
                  <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0 break-words">{tournament.location}</span>
                </span>
              ) : null}
            </p>
          </div>
          <dl className={"flex gap-4 tabular-nums sm:text-right " + (featured ? "text-base" : "text-sm")}>
            <div>
              <dt className="text-muted">Punkti</dt>
              <dd className={featured ? "font-display text-4xl text-pine" : "text-lg font-medium"}>
                {formatPoints(tournament.points)}
                {cap && tournament.points != null ? (
                  <span className="text-base font-sans text-muted">
                    {" "}
                    no {cap.value}
                    {cap.playedOnly ? " nospēlētām" : ""}
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Vieta</dt>
              <dd className={featured ? "font-display text-4xl text-pine" : "text-lg font-medium"}>
                {tournament.rank != null ? (
                  <>
                    {tournament.rank}.
                    {tournament.fieldSize ? <span className="text-base font-sans text-muted"> no {tournament.fieldSize}</span> : null}
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>
          <ChevronDown className="hidden size-5 shrink-0 text-muted transition-transform group-open:rotate-180 sm:block" aria-hidden />
        </summary>
        <div className="border-t border-line px-4 py-3 sm:px-5">
          <MetaLine tournament={tournament} />
          <Neighbors tournament={tournament} />
          {tournament.partial ? (
            <p className="text-sm text-brass">Partiju sarakstu šoreiz neizdevās nolasīt.</p>
          ) : (
            <>
              <RoundNote dossier={dossier} tournament={tournament} featured={featured} />
              <RoundLine games={tournament.games} scheduled={tournament.roundsScheduled} nextRound={tournament.nextGame?.round} />
              <GameTable games={games} nextRound={tournament.nextGame?.round} />
            </>
          )}
          <a
            href={tournament.playerUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex h-12 items-center gap-2 text-sm font-medium text-pine"
          >
            Atvērt chess-results
            <ExternalLink className="size-4" aria-hidden />
          </a>
        </div>
      </details>
    </article>
  );
}

function ColorDot({ color }: { color: PieceColor }) {
  if (color === "unknown") return null;
  return (
    <span
      aria-hidden
      className={
        "inline-block size-2.5 shrink-0 rounded-full ring-1 ring-[#5c6b63] " + (color === "white" ? "bg-[#f7f4ee]" : "bg-[#14241c]")
      }
    />
  );
}

function GameTable({ games, nextRound }: { games: Game[]; nextRound?: number }) {
  if (games.length === 0) return <p className="text-sm text-muted">Partijas vēl nav publicētas.</p>;
  return (
    <ol className="grid max-w-3xl gap-1.5">
      {games.map((game) => {
        const upcoming = game.score == null && game.round === nextRound;
        const details = [
          colorName(game.color).toLocaleLowerCase("lv"),
          game.board > 0 ? `${game.board}. galds` : "",
          game.opponentClub,
        ].filter(Boolean);
        return (
          <li
            key={`${game.tournamentId}-${game.round}-${game.opponent}`}
            className={
              "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl py-2.5 pr-3 pl-0 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:px-3 " +
              (upcoming ? "bg-pine-soft" : "bg-bg")
            }
          >
            <span className="hidden text-sm text-muted tabular-nums sm:block">{game.round}.</span>
            <span className="min-w-0">
              <span className="block truncate font-medium">{game.opponent}</span>
              <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted">
                <span className="shrink-0 sm:hidden">{game.round}. kārta ·</span>
                <ColorDot color={game.color} />
                <span className="truncate">{details.join(" · ")}</span>
              </span>
            </span>
            {upcoming ? (
              <span className="rounded-full bg-pine px-3 py-1 text-xs font-medium text-white">Nākamā</span>
            ) : (
              <ResultMark result={game.result} unplayed={game.unplayed} labeled />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function OpponentRow({
  opponent,
  pressed,
  onSelect,
}: {
  opponent: Opponent;
  pressed: boolean;
  onSelect: () => void;
}) {
  const percent = opponent.scored ? Math.round((opponent.score / opponent.scored) * 100) : 0;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onSelect}
      className={
        "flex min-h-11 w-full items-center gap-3 rounded-2xl border border-line px-3 py-2 text-left motion-reduce:transition-none " +
        (pressed ? "bg-pine-soft" : "bg-surface")
      }
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-bg-deep text-sm font-medium">
        {initials(opponent.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">
          {opponent.name}
          {opponent.games > 1 ? <span className="text-muted"> · {opponent.games}×</span> : null}
        </span>
        <span className="block truncate text-sm text-muted">{opponent.club || opponent.fed}</span>
      </span>
      <span className="text-right">
        <span className="block font-medium tabular-nums">
          {opponent.wins}–{opponent.draws}–{opponent.losses}
        </span>
        <span className="block text-sm text-muted tabular-nums">{pointsLabel(opponent.score)} · {percent}%</span>
      </span>
    </button>
  );
}

function Meetings({ opponent }: { opponent: Opponent }) {
  const games = [...opponent.meetings].sort((a, b) => {
    const left = isoDate(a.tournamentDate) || a.tournamentDate;
    const right = isoDate(b.tournamentDate) || b.tournamentDate;
    if (left !== right) return left < right ? 1 : -1;
    return b.round - a.round;
  });
  return (
    <div className="mt-3 rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <Trophy className="size-4 text-pine" aria-hidden />
        <h3 className="text-xl">{opponent.name}</h3>
      </div>
      <ul className="grid gap-3">
        {games.length === 0 ? (
          <li className="text-sm text-muted">Par šo pretinieku partiju detaļas nav saglabātas.</li>
        ) : (
          games.map((game) => (
          <li key={`${game.tournamentId}-${game.round}`} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
            <div className="flex items-start justify-between gap-3">
              <PieceMark color={game.color} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{game.tournamentName}</p>
                <p className="mt-1 text-sm text-muted">
                  {formatDate(game.tournamentDate)} · {game.round}. kārta · {colorName(game.color).toLocaleLowerCase("lv")}
                </p>
                {game.location ? (
                  <p className="mt-1 flex items-start gap-1 text-sm text-muted">
                    <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {game.location}
                  </p>
                ) : null}
              </div>
              <ResultMark result={game.result} unplayed={game.unplayed} />
            </div>
          </li>
          ))
        )}
      </ul>
    </div>
  );
}

function PieceMark({ color }: { color: PieceColor }) {
  if (color === "unknown") return <span className="size-11 shrink-0" />;
  const white = color === "white";
  return (
    <span
      className={
        "grid size-11 shrink-0 place-items-center rounded-md " +
        (white ? "bg-pine" : "border border-line bg-piece")
      }
    >
      <Knight tone={white ? "white" : "black"} className="size-10" />
    </span>
  );
}

function ResultMark({
  result,
  labeled = false,
  unplayed,
}: {
  result: GameResult;
  labeled?: boolean;
  unplayed?: Game["unplayed"];
}) {
  const base = {
    win: { label: "1", name: "Uzvara", cls: "bg-pine text-white" },
    draw: { label: "½", name: "Neizšķirts", cls: "bg-bg-deep text-ink" },
    loss: { label: "0", name: "Zaudējums", cls: "bg-loss/15 text-loss" },
    unknown: { label: "–", name: "Nav rezultāta", cls: "border border-dashed border-line text-muted" },
  }[result];
  // Forfeits and byes keep their points but are drawn outlined: no game was played.
  const view =
    unplayed === "bye"
      ? { ...base, name: "Brīva kārta", cls: "border border-line text-muted" }
      : unplayed === "forfeit"
        ? result === "win"
          ? { label: "+", name: "Uzvara bez spēles", cls: "border border-pine text-pine" }
          : { label: "−", name: "Zaudējums bez spēles", cls: "border border-loss text-loss" }
        : base;
  const mark = (
    <span
      title={view.name}
      aria-hidden
      className={`grid size-9 shrink-0 place-items-center rounded-full text-sm font-medium tabular-nums ${view.cls}`}
    >
      {view.label}
    </span>
  );
  if (!labeled) {
    return (
      <span role="img" aria-label={view.name} className="inline-flex">
        {mark}
      </span>
    );
  }
  // The colour carries the result; the word is spelled out where there is room and always for screen readers.
  return (
    <span role="img" className="inline-flex items-center gap-2 sm:w-[8rem]" aria-label={`${view.label}, ${view.name}`}>
      {mark}
      <span className="hidden whitespace-nowrap text-sm text-muted sm:inline">{view.name}</span>
    </span>
  );
}

function liveTournaments(dossier: Dossier): Tournament[] {
  return dossier.tournaments.filter((tournament) => dayStatus(tournament.endDate, dossier.today) === "today" || tournament.nextGame || tournament.awaitingPairing);
}

function colorName(color: PieceColor): string {
  if (color === "white") return "Baltie";
  if (color === "black") return "Melnie";
  return "Krāsa vēl nav zināma";
}

function priorGames(dossier: Dossier, name: string): Game[] {
  const key = foldName(name);
  if (!key || isBye(name)) return [];
  return dossier.tournaments
    .flatMap((tournament) => tournament.games)
    .filter((game) => foldName(game.opponent) === key && isPlayed(game));
}

function resultWord(result: GameResult): string {
  if (result === "win") return "uzvara";
  if (result === "draw") return "neizšķirts";
  if (result === "loss") return "zaudējums";
  return "bez rezultāta";
}

function shortTime(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  const minutes = text.match(/(\d+)\s*(?:min|minūt)/i);
  const seconds = text.match(/\+\s*(\d+)/);
  if (!minutes) return text;
  const clock = seconds ? `${minutes[1]}+${seconds[1]}` : `${minutes[1]} min`;
  const kind = paceOf(text);
  const pace = kind === "blitz" ? "Blitz" : kind === "rapid" ? "Rapid" : "";
  return pace ? `${pace} · ${clock}` : clock;
}

function historyLine(games: Game[]): string {
  if (games.length === 0) return "Pirmo reizi";
  const wins = games.filter((game) => game.result === "win").length;
  const draws = games.filter((game) => game.result === "draw").length;
  const losses = games.filter((game) => game.result === "loss").length;
  const times = games.length === 1 ? "1 reizi" : `${games.length} reizes`;
  return `Jau ${times} · ${wins}–${draws}–${losses}`;
}

function latestMeeting(games: Game[]): Game | null {
  return (
    [...games].sort((a, b) =>
      a.tournamentDate < b.tournamentDate ? 1 : a.tournamentDate > b.tournamentDate ? -1 : b.round - a.round,
    )[0] ?? null
  );
}

function tournamentCountLabel(count: number): string {
  return count % 10 === 1 && count % 100 !== 11 ? `${count} turnīrs` : `${count} turnīri`;
}

function Glance({ glance }: { glance: OpponentGlance }) {
  return (
    <div className="mt-3 rounded-xl bg-white/10 px-3 py-3 text-sm">
      <p>
        FIDE {glance.fideId} · {tournamentCountLabel(glance.tournaments)}
        {glance.bestRank ? ` · labākā vieta ${glance.bestRank}.` : ""}
      </p>
      {glance.recent.length > 0 ? (
        <ul className="mt-2 grid gap-1 text-on-pine">
          {glance.recent.map((row) => (
            <li key={`${row.endDate}-${row.name}`}>
              {row.endDate ? `${formatDate(row.endDate)} · ` : ""}
              {row.name}
              {row.rank ? ` · ${row.rank}. vieta` : ""}
              {row.fieldSize ? ` no ${row.fieldSize}` : ""}
              {row.rounds ? ` · ${row.rounds} kārtas` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FilterChip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={
        "h-12 rounded-full px-4 text-sm font-medium " +
        (pressed ? "bg-pine text-white" : "border border-line bg-surface")
      }
    >
      {children}
    </button>
  );
}

function initials(name: string): string {
  const [surname, given] = name.split(",").map((part) => part.trim());
  const first = surname?.[0] ?? "";
  const second = given?.split(/\s+/)[0]?.[0] ?? "";
  return `${first}${second}`.toLocaleUpperCase("lv") || "?";
}

function placeLine(tournament: Tournament): string {
  const bits: string[] = [];
  if (tournament.rank) bits.push(`${tournament.rank}. vieta${tournament.fieldSize ? ` no ${tournament.fieldSize}` : ""}`);
  if (tournament.points != null) bits.push(pointsLabel(tournament.points));
  if (!bits.length && tournament.location) bits.push(tournament.location);
  return bits.join(" · ");
}

function MiniBoard({ color, className = "size-16" }: { color: PieceColor; className?: string }) {
  if (color === "unknown") return <span className={className} />;
  const white = color === "white";
  const squares = [false, true, true, false];
  return (
    <span className={`grid grid-cols-2 overflow-hidden rounded-md border border-line ${className}`}>
      {squares.map((light, index) => {
        const show = (white && !light && index === 0) || (!white && light && index === 1);
        return (
          <span key={index} className={`grid place-items-center ${light ? "bg-piece" : "bg-[#1e4a38]"}`}>
            {show ? <Knight tone={white ? "white" : "black"} className="size-3/5" /> : null}
          </span>
        );
      })}
    </span>
  );
}

function Neighbors({ tournament, light = false }: { tournament: Tournament; light?: boolean }) {
  const rows = tournament.standings;
  if (!rows || (!rows.above && !rows.below)) return null;
  return (
    <p className={`text-sm ${light ? "mt-2 text-on-pine" : "mb-3 text-muted"}`}>
      {rows.above ? `Virs: ${rows.above.rank}. ${personName(rows.above.name)} (${formatPoints(rows.above.points)})` : "Neviens nav virs"}
      {" · "}
      {rows.below ? `Zem: ${rows.below.rank}. ${personName(rows.below.name)} (${formatPoints(rows.below.points)})` : "Neviens nav zem"}
    </p>
  );
}

/** One box per round of the tournament: results so far, the next round marked, the rest outlined. */
function RoundLine({ games, scheduled, nextRound }: { games: Game[]; scheduled: number | null; nextRound?: number }) {
  const byRound = new Map(games.map((game) => [game.round, game]));
  const lastRound = Math.max(scheduled ?? 0, ...games.map((game) => game.round));
  if (lastRound < 1 || games.length === 0) return null;
  const rounds = Array.from({ length: lastRound }, (_, index) => index + 1);
  return (
    <div className="mb-3">
      <p className="mb-2 text-sm text-muted">Partiju rezultāti</p>
      <ol className="flex gap-1.5 overflow-x-auto pb-1">
        {rounds.map((round) => {
          const game = byRound.get(round);
          const score = game?.score ?? null;
          const mark =
            score == null ? "" : game?.unplayed === "forfeit" ? (score >= 1 ? "+" : "−") : score >= 1 ? "1" : score > 0 ? "½" : "0";
          const tone =
            score != null
              ? score >= 1
                ? "bg-pine text-white"
                : score > 0
                  ? "bg-bg-deep text-ink"
                  : "bg-loss/15 text-loss"
              : round === nextRound
                ? "border-2 border-pine text-pine"
                : "border border-dashed border-line text-muted";
          const title = game ? `${round}. kārta: ${game.opponent}` : `${round}. kārta`;
          return (
            <li
              key={round}
              className={`grid h-12 w-9 shrink-0 grid-rows-2 place-items-center rounded-lg text-center tabular-nums ${tone}`}
              title={title}
              aria-label={`${title}${mark ? `, ${mark}` : round === nextRound ? ", nākamā" : ""}`}
            >
              <span className="text-xs leading-none opacity-70">{round}</span>
              <span className="text-sm leading-none font-medium">{mark || (round === nextRound ? "•" : "")}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function summaryText(dossier: Dossier): string {
  const tournament =
    dossier.tournaments.find((item) => item.endDate === dossier.today) ??
    dossier.tournaments.find((item) => item.points != null) ??
    dossier.tournaments[0];
  if (!tournament) return "Nav turnīru.";
  const played = tournament.games.filter((game) => game.score != null).length;
  const when = tournament.endDate === dossier.today ? " šodien" : ` ${formatDate(tournament.endDate)}`;
  const lines = [
    `${DISPLAY_NAME}${when}: ${pointsLabel(tournament.points)}${played ? ` no ${played} partijām` : ""}.`,
  ];
  if (tournament.rank) lines.push(`${tournament.rank}. vieta${tournament.fieldSize ? ` no ${tournament.fieldSize}` : ""}.`);
  const next = tournament.nextGame;
  if (next) {
    const played = priorGames(dossier, next.opponent);
    lines.push(
      `Nākamā: ${next.round}. kārta, ${next.board > 0 ? `${next.board}. galds, ` : ""}${colorName(next.color).toLocaleLowerCase("lv")} pret ${personName(next.opponent)}. ${historyLine(played)}.`,
    );
    if (next.startsAt) lines.push(`Sākums ${next.startsAt}.`);
  }
  if (tournament.standings?.above) {
    lines.push(`Virs: ${tournament.standings.above.name}, ${formatPoints(tournament.standings.above.points)}.`);
  }
  if (tournament.standings?.below) {
    lines.push(`Zem: ${tournament.standings.below.name}, ${formatPoints(tournament.standings.below.points)}.`);
  }
  return lines.join(" ");
}

function CopySummary({ dossier, compact = false }: { dossier: Dossier; compact?: boolean }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(summaryText(dossier));
    } catch {
      return;
    }
    setDone(true);
    window.setTimeout(() => setDone(false), 1600);
  }
  return (
    <button
      type="button"
      aria-label="Kopēt kopsavilkumu"
      onClick={() => void copy()}
      className={
        compact
          ? "inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-white/15 px-3 text-sm font-medium"
          : "inline-flex h-11 items-center gap-2 rounded-full border border-line px-4 text-sm font-medium"
      }
    >
      <Copy className="size-4" aria-hidden />
      {done ? "Nokopēts" : compact ? "Kopsavilkums" : "Kopēt kopsavilkumu"}
    </button>
  );
}

function LiveDock({ dossier, tournament }: { dossier: Dossier; tournament: Tournament }) {
  const next = tournament.nextGame;
  if (!next) return null;
  const bye = isBye(next.opponent);
  return (
    <div className="border-t border-white/20 bg-pine text-white">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2 sm:px-6">
        <MiniBoard color={next.color} className="size-12 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {next.round}. kārta · {next.board > 0 ? `${next.board}. galds` : "galds nav zināms"} · {colorName(next.color).toLocaleLowerCase("lv")}
            {next.startsAt ? ` · ${next.startsAt}` : ""}
          </p>
          <p className="truncate">pret {bye ? "brīvu kārtu" : personName(next.opponent)}</p>
          <p className="truncate text-sm text-on-pine">
            {bye ? placeLine(tournament) : `${historyLine(priorGames(dossier, next.opponent))} · ${placeLine(tournament)}`}
          </p>
        </div>
        <CopySummary dossier={dossier} compact />
      </div>
    </div>
  );
}
