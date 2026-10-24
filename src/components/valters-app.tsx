import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bell,
  BellOff,
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
import { getDossier } from "@/lib/chess/dossier";
import {
  dayStatus,
  formatDate,
  formatPoints,
  formatStamp,
} from "@/lib/chess/parse";
import type { Dossier, Game, GameResult, LoadResult, Opponent, PieceColor, Tournament } from "@/lib/chess/types";

const DISPLAY_NAME = "Valters Avotiņš";

function freshnessLabel(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "nav zināms";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (mins < 1) return "tikko";
  if (mins < 60) return `pirms ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `pirms ${hours} h`;
  return `pirms ${Math.floor(hours / 24)} d`;
}

function displayTournamentName(name: string, endDate: string): string {
  if (!endDate) return name;
  const iso = endDate.slice(0, 10);
  const parts = iso.split("-");
  if (parts.length < 3) return name;
  const [year, month, day] = parts;
  const forms = [
    formatDate(iso),
    iso,
    `${year}/${month}/${day}`,
    `${day}.${month}.${year}`,
    `${day}.${month}.${year.slice(2)}`,
  ];
  let next = name;
  for (const form of forms) {
    if (form && next.includes(form)) next = next.replace(form, " ");
  }
  return next.replace(/\s{2,}/g, " ").replace(/\s+([,.:;–-])/g, "$1").trim();
}

function statusClass(label: string | null): string {
  if (label === "Notiek") return "bg-pine text-surface";
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
    setEnabled(localStorage.getItem(ALERT_KEY) === "1" && Notification.permission === "granted");
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
      localStorage.removeItem(ALERT_KEY);
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
      localStorage.removeItem(ALERT_KEY);
      setEnabled(false);
      setNote("Paziņojumi ir bloķēti. Atļauj tos pārlūka iestatījumos.");
      return;
    }
    try {
      if ("serviceWorker" in navigator) await navigator.serviceWorker.register("/sw.js");
    } catch {
      /* page notification still works */
    }
    localStorage.setItem(ALERT_KEY, "1");
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
      setResult(await getDossier({ data: { refresh: true } }));
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
            className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-pine px-5 font-medium text-surface disabled:opacity-60"
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
      <TopBar dossier={result.dossier} loading={loading} onRefresh={refresh} tab={tab} onTab={setTab} />
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
        {tab === "now" ? <CurrentView dossier={result.dossier} alerts={alerts} /> : null}
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
  return (
    <div className="relative z-0 min-h-screen overflow-x-clip text-ink">
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

function TopBar({
  dossier,
  loading,
  onRefresh,
  tab,
  onTab,
}: {
  dossier: Dossier;
  loading: boolean;
  onRefresh: () => void;
  tab: PageTab;
  onTab: (tab: PageTab) => void;
}) {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark");
  }, []);
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "dark" ? "" : "dark";
    if (next) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    localStorage.setItem("valters-theme", next ? "dark" : "light");
    setDark(Boolean(next));
  }
  const live = dossier.tournaments.find((tournament) => tournament.nextGame);
  const fresh = freshnessLabel(dossier.fetchedAt);
  const stamped = formatStamp(dossier.fetchedAt);
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white/95">
      <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              aria-label="Pārlādēt un atvērt aktuālo turnīru"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-pine"
            >
              <Knight tone="white" className="size-10 p-0.5" />
            </button>
            <h1 className="min-w-0 pt-1 text-2xl leading-tight sm:text-3xl">{DISPLAY_NAME}</h1>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onRefresh}
                disabled={loading}
                aria-busy={loading}
                aria-label={loading ? "Atjauno" : "Atjaunot"}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-pine px-3 font-medium text-surface disabled:opacity-60 sm:px-4"
              >
                <RefreshCw className={loading ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} />
                <span className="hidden sm:inline">{loading ? "Atjauno…" : "Atjaunot"}</span>
              </button>
              <button
                type="button"
                onClick={toggleTheme}
                aria-pressed={dark}
                aria-label={dark ? "Gaišā tēma" : "Tumšā tēma"}
                className="inline-flex size-11 items-center justify-center rounded-full border border-line bg-surface"
              >
                {dark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
              </button>
            </div>
            <p className="text-xs text-muted" title={stamped ? `Atjaunots ${stamped}` : undefined}>
              {loading ? "Notiek" : `Dati ${fresh}`}
            </p>
          </div>
        </div>
        <p className="mt-1 text-sm leading-snug text-muted">
          FIDE {dossier.player.fideId}
          {dossier.player.club ? ` · ${dossier.player.club}` : ""}
        </p>
      </div>
      {live ? <LiveDock dossier={dossier} tournament={live} /> : null}
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

function Overview({ alerts, dossier }: { alerts: AlertState; dossier: Dossier }) {
  return (
    <section className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <button
        type="button"
        onClick={() => void alerts.toggle()}
        aria-pressed={alerts.enabled}
        className={
          "inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-medium " +
          (alerts.enabled ? "border border-pine bg-white text-pine" : "border border-line bg-surface")
        }
      >
        {alerts.enabled ? <BellOff className="size-4" aria-hidden /> : <Bell className="size-4" aria-hidden />}
        {alerts.enabled ? "Paziņojumi ieslēgti" : "Paziņot telefonā"}
      </button>
      <CopySummary dossier={dossier} />
      {alerts.note ? <p className="w-full text-sm text-muted">{alerts.note}</p> : null}
      <details className="w-full">
        <summary className="cursor-pointer text-sm text-muted">Kā darbojas paziņojumi</summary>
        <p className="mt-1 max-w-xl text-sm text-muted">
          Ja ieslēgsi paziņojumus, telefons paziņos, kad chess-results publicēs nākamo pretinieku. Lapa jātur atvērta.
        </p>
      </details>
    </section>
  );
}

function CurrentView({ dossier, alerts }: { dossier: Dossier; alerts: AlertState }) {
  const live = liveTournaments(dossier);
  const shown = live.length > 0 ? live : dossier.tournaments.slice(0, 1);
  return (
    <div className="grid gap-4">
      <NextGames dossier={dossier} />
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
            startOpen
            featured
          />
        ))
      )}
      <Overview alerts={alerts} dossier={dossier} />
    </div>
  );
}

function StatsView({ dossier }: { dossier: Dossier }) {
  const { totals } = dossier;
  const stats = [
    { label: "Turnīri", value: String(totals.tournaments), hint: "" },
    { label: "Partijas", value: String(totals.games), hint: "" },
    { label: "Punkti", value: formatPoints(totals.score), hint: "" },
    {
      label: "Bilance",
      value: `${totals.wins}–${totals.draws}–${totals.losses}`,
      hint: "Uzvaras / neizšķirti / zaudējumi",
    },
  ];
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-line bg-white px-4 py-4">
            <p className="text-sm text-muted">{stat.label}</p>
            <p className="mt-1 font-display text-3xl text-pine tabular-nums">{stat.value}</p>
            {stat.hint ? <p className="mt-1 text-xs text-muted">{stat.hint}</p> : null}
          </div>
        ))}
      </div>
      {totals.bestRank ? <p className="text-lg">Labākā vieta — {totals.bestRank}.</p> : null}
      <Charts dossier={dossier} />
    </div>
  );
}

function fold(value: string): string {
  return value.toLocaleLowerCase("lv").replace(/[āčēģīķļņšūžŗ]/g, (letter) => {
    const map: Record<string, string> = {
      ā: "a",
      č: "c",
      ē: "e",
      ģ: "g",
      ī: "i",
      ķ: "k",
      ļ: "l",
      ņ: "n",
      š: "s",
      ū: "u",
      ž: "z",
      ŗ: "r",
    };
    return map[letter] ?? letter;
  });
}

function matchesQuery(haystack: string, query: string): boolean {
  const words = fold(query).split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = fold(haystack);
  return words.every((word) => text.includes(word));
}

function Board({ dossier, part }: { dossier: Dossier; part: "tournaments" | "opponents" }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [year, setYear] = useState("all");
  const [pace, setPace] = useState("all");
  const [opponentSort, setOpponentSort] = useState<"games" | "name">("games");
  const needle = query.trim();
  const years = useMemo(() => {
    const found = new Set(dossier.tournaments.map((tournament) => tournament.endDate.slice(0, 4)).filter(Boolean));
    return [...found].sort((a, b) => (a < b ? 1 : -1));
  }, [dossier.tournaments]);

  const scoped = useMemo(() => {
    return dossier.tournaments.filter((tournament) => {
      if (year !== "all" && !tournament.endDate.startsWith(year)) return false;
      const rapid = /rapid|ātr|minut/i.test(tournament.timeControl);
      if (pace === "rapid" && !rapid) return false;
      if (pace === "other" && (rapid || !tournament.timeControl)) return false;
      return true;
    });
  }, [dossier.tournaments, year, pace]);

  const scopedOpponents = useMemo(() => {
    if (year === "all" && pace === "all") return dossier.opponents;
    const ids = new Set(scoped.map((tournament) => tournament.id));
    return dossier.opponents.flatMap((opponent) => {
      const meetings = opponent.meetings.filter((game) => ids.has(game.tournamentId));
      if (meetings.length === 0) return [];
      if (meetings.length === opponent.meetings.length) return [opponent];
      let wins = 0;
      let draws = 0;
      let losses = 0;
      let score = 0;
      let scored = 0;
      for (const game of meetings) {
        if (game.score == null) continue;
        scored += 1;
        score += game.score;
        if (game.result === "win") wins += 1;
        if (game.result === "draw") draws += 1;
        if (game.result === "loss") losses += 1;
      }
      return [{ ...opponent, meetings, games: meetings.length, wins, draws, losses, score, scored }];
    });
  }, [dossier.opponents, scoped, year, pace]);

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

  const orderedOpponents = useMemo(() => {
    const totals = new Map<string, number>();
    for (const opponent of opponents) {
      const key = fold(opponent.name);
      totals.set(key, (totals.get(key) ?? 0) + (opponent.meetings.length || opponent.games));
    }
    const rows = [...opponents];
    rows.sort((a, b) => {
      if (opponentSort === "name") return a.name.localeCompare(b.name, "lv");
      const byGames = (totals.get(fold(b.name)) ?? 0) - (totals.get(fold(a.name)) ?? 0);
      return byGames || a.name.localeCompare(b.name, "lv");
    });
    return rows;
  }, [opponents, opponentSort]);

  const repeats = useMemo(() => {
    const groups = new Map<string, Opponent[]>();
    for (const opponent of opponents) {
      const key = fold(opponent.name);
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
        key: `repeat:${fold(first.name)}`,
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
    return rows.sort((a, b) => b.games - a.games || a.name.localeCompare(b.name, "lv"));
  }, [opponents]);
  const repeatNames = useMemo(() => new Set(repeats.map((opponent) => fold(opponent.name))), [repeats]);
  const onceOpponents = useMemo(
    () => orderedOpponents.filter((opponent) => !repeatNames.has(fold(opponent.name))),
    [orderedOpponents, repeatNames],
  );
  const active = repeats.find((opponent) => opponent.key === selected) ?? onceOpponents.find((opponent) => opponent.key === selected) ?? null;

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
              : onceOpponents.length + repeats.length === 1
                ? "1 pretinieks"
                : `${onceOpponents.length + repeats.length} pretinieki`}
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
          {repeats.length > 0 ? (
            <section>
              <SectionTitle title="Atkārtoti pretinieki" hint="spēlēts vairāk nekā vienu reizi" />
              <p className="mb-2 text-sm text-muted">Uzvaras / neizšķirti / zaudējumi</p>
              <ul className="grid gap-1.5">
                {repeats.map((opponent) => (
                  <li key={opponent.key}>
                    <OpponentRow
                      opponent={opponent}
                      pressed={opponent.key === selected}
                      onSelect={() => setSelected((current) => (current === opponent.key ? null : opponent.key))}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {onceOpponents.length > 0 ? (
            <section>
              <SectionTitle title="Pretinieki" hint="partijas, bilance, punkti un punktu īpatsvars" />
              <p className="mb-2 text-sm text-muted">Uzvaras / neizšķirti / zaudējumi</p>
              <ul className="grid gap-1.5">
                {onceOpponents.map((opponent) => (
                  <li key={opponent.key}>
                    <OpponentRow
                      opponent={opponent}
                      pressed={opponent.key === selected}
                      onSelect={() => setSelected((current) => (current === opponent.key ? null : opponent.key))}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : repeats.length === 0 ? (
            <Empty>{needle ? "Nav pretinieku, kas atbilst meklējumam." : "Vēl nav pretinieku šajos turnīros."}</Empty>
          ) : null}
          {active ? <Meetings opponent={active} /> : null}
        </>
      )}
    </div>
  );
}

function SectionTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-2xl">{title}</h2>
      <p className="text-sm text-muted">{hint}</p>
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
            <div className="flex flex-wrap items-center gap-2">
              {label ? (
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(label)}`}>{label}</span>
              ) : null}
              {medal ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-pine-soft px-2 py-0.5 text-xs font-medium text-pine">
                  <Trophy className="size-3.5" aria-hidden />
                  {tournament.rank}. vieta
                </span>
              ) : null}
              <h3 className={featured ? "text-2xl" : "text-xl"}>{displayTournamentName(tournament.name, tournament.endDate)}</h3>
            </div>
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
                {cap ? (
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
          <ChevronDown className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="border-t border-line px-4 py-3 sm:px-5">
          <MetaLine tournament={tournament} />
          <Neighbors tournament={tournament} />
          {tournament.partial ? (
            <p className="text-sm text-brass">Partiju sarakstu šoreiz neizdevās nolasīt.</p>
          ) : (
            <>
              <RoundNote dossier={dossier} tournament={tournament} />
              <RoundLine games={games} />
              <GameTable games={games} />
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

function GameTable({ games }: { games: Game[] }) {
  if (games.length === 0) return <p className="text-sm text-muted">Partijas vēl nav publicētas.</p>;
  return (
    <div>
      <div className="mb-2 hidden grid-cols-[3rem_minmax(0,1fr)_6rem_4.5rem_9rem] gap-3 px-3 text-xs font-medium text-muted sm:grid">
        <span>Kārta</span>
        <span>Pretinieks</span>
        <span>Krāsa</span>
        <span>Galds</span>
        <span>Rezultāts</span>
      </div>
      <ol className="grid gap-2">
        {games.map((game) => (
          <li key={`${game.tournamentId}-${game.round}-${game.opponent}`} className="rounded-xl bg-bg px-3 py-3">
            <div className="flex items-start justify-between gap-3 sm:hidden">
              <span className="min-w-0">
                <span className="block truncate font-medium">{game.opponent}</span>
                {game.opponentClub ? <span className="block truncate text-sm text-muted">{game.opponentClub}</span> : null}
              </span>
              <ResultMark result={game.result} labeled />
            </div>
            <p className="mt-1 flex items-center gap-2 text-sm text-muted sm:hidden">
              <PieceMark color={game.color} />
              <span>
                {game.round}. kārta · {colorName(game.color).toLocaleLowerCase("lv")}
                {game.board > 0 ? ` · ${game.board}. galds` : ""}
              </span>
            </p>
            <div className="hidden items-center gap-3 sm:grid sm:grid-cols-[3rem_minmax(0,1fr)_6rem_4.5rem_9rem]">
              <span className="text-sm text-muted tabular-nums">{game.round}.</span>
              <span className="min-w-0">
                <span className="block truncate font-medium">{game.opponent}</span>
                {game.opponentClub ? <span className="block truncate text-sm text-muted">{game.opponentClub}</span> : null}
              </span>
              <span className="inline-flex items-center gap-2 text-sm">
                <PieceMark color={game.color} />
                <span className="sr-only">{colorName(game.color)}</span>
              </span>
              <span className="text-sm tabular-nums">{game.board > 0 ? game.board : "—"}</span>
              <ResultMark result={game.result} labeled />
            </div>
          </li>
        ))}
      </ol>
    </div>
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
        <span className="block text-sm text-muted tabular-nums">{formatPoints(opponent.score)} punkti · {percent}%</span>
      </span>
    </button>
  );
}

function Meetings({ opponent }: { opponent: Opponent }) {
  return (
    <div className="mt-3 rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <Trophy className="size-4 text-pine" aria-hidden />
        <h3 className="text-xl">{opponent.name}</h3>
      </div>
      <ul className="grid gap-3">
        {opponent.meetings.map((game) => (
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
              <ResultMark result={game.result} />
            </div>
          </li>
        ))}
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
        (white ? "bg-pine" : "border border-line bg-white")
      }
    >
      <Knight tone={white ? "white" : "black"} className="size-10" />
    </span>
  );
}

function ResultMark({ result, labeled = false }: { result: GameResult; labeled?: boolean }) {
  const view = {
    win: { label: "1", name: "Uzvara", cls: "bg-pine-soft text-pine" },
    draw: { label: "½", name: "Neizšķirts", cls: "bg-bg-deep text-ink" },
    loss: { label: "0", name: "Zaudējums", cls: "bg-bg-deep text-loss" },
    unknown: { label: "–", name: "Nav rezultāta", cls: "bg-bg-deep text-muted" },
  }[result];
  const mark = (
    <span
      title={view.name}
      aria-hidden={labeled}
      className={`grid size-11 place-items-center rounded-full text-sm font-medium tabular-nums ${view.cls}`}
    >
      {view.label}
    </span>
  );
  if (!labeled) {
    return (
      <span aria-label={view.name} className="inline-flex">
        {mark}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2" aria-label={`${view.label}, ${view.name}`}>
      {mark}
      <span className="text-sm">{view.name}</span>
    </span>
  );
}

function liveTournaments(dossier: Dossier): Tournament[] {
  return dossier.tournaments.filter((tournament) => dayStatus(tournament.endDate, dossier.today) === "today" || tournament.nextGame || tournament.awaitingPairing);
}

function NextGames({ dossier }: { dossier: Dossier }) {
  const cards = liveTournaments(dossier).filter((tournament) => tournament.nextGame || tournament.awaitingPairing || dayStatus(tournament.endDate, dossier.today) === "today");
  if (cards.length === 0) return null;
  return (
    <div className="grid gap-3">
      {cards.map((tournament) =>
        tournament.nextGame ? (
          <NextGameBanner key={tournament.id} dossier={dossier} tournament={tournament} />
        ) : (
          <LiveStatus key={tournament.id} tournament={tournament} />
        ),
      )}
    </div>
  );
}

function colorName(color: PieceColor): string {
  if (color === "white") return "Baltie";
  if (color === "black") return "Melnie";
  return "Krāsa vēl nav zināma";
}

function priorGames(dossier: Dossier, name: string): Game[] {
  const key = fold(name);
  if (!key || isBye(name)) return [];
  return dossier.tournaments
    .flatMap((tournament) => tournament.games)
    .filter((game) => fold(game.opponent) === key && game.score != null);
}

function isBye(name: string): boolean {
  return /^(brīvs|bye|spielfrei)$/i.test(name.trim());
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
  const pace = /blitz|žaub/i.test(text) ? "Blitz" : /rapid|ātr/i.test(text) ? "Rapid" : "";
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

function NextGameBanner({ dossier, tournament }: { dossier: Dossier; tournament: Tournament }) {
  const next = tournament.nextGame;
  if (!next) return null;
  const bye = isBye(next.opponent);
  const played = priorGames(dossier, next.opponent);
  const last = latestMeeting(played);
  return (
    <section className="overflow-hidden rounded-2xl bg-pine text-white">
      <div className="grid sm:grid-cols-[8.5rem_1fr]">
        <div className="grid place-items-center bg-white px-4 py-5">
          <MiniBoard color={next.color} />
        </div>
        <div className="px-5 py-5 sm:px-6">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium tracking-wide uppercase">Nākamā partija</p>
            <p className="text-sm tabular-nums">{next.round}. kārta</p>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-8">
            <div>
              <p className="text-sm text-pine-soft">Galdiņš</p>
              <p className="font-display text-6xl leading-none tabular-nums">{next.board > 0 ? next.board : "—"}</p>
            </div>
            <div>
              <p className="text-sm text-pine-soft">Krāsa</p>
              <p className="mt-2 font-display text-3xl">{colorName(next.color)}</p>
            </div>
          </div>
          <p className="mt-4 text-lg">
            {bye ? "Brīva kārta" : `pret ${next.opponent}${next.opponentTitle ? `, ${next.opponentTitle}` : ""}`}
          </p>
          {bye ? null : (
            <>
              <p className="mt-1 text-sm text-pine-soft">
                {historyLine(played)}
                {next.opponentFed ? ` · ${next.opponentFed}` : ""}
              </p>
              {last ? (
                <p className="mt-1 text-sm text-pine-soft">
                  Pēdējo reizi {formatDate(last.tournamentDate)}: {resultWord(last.result)},{" "}
                  {colorName(last.color).toLocaleLowerCase("lv")}
                  {last.tournamentName ? ` · ${last.tournamentName}` : ""}
                </p>
              ) : null}
            </>
          )}
          <p className="mt-1 text-sm text-pine-soft">
            {placeLine(tournament)}
            {next.startsAt ? ` · sākums ${next.startsAt}` : tournament.lastRoundAt ? ` · iepriekšējās kārtas sākums ${tournament.lastRoundAt}` : ""}
          </p>
          <Neighbors tournament={tournament} light />
          <a
            href={next.url}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex h-11 items-center gap-2 text-sm font-medium text-white"
          >
            Izloze chess-results
            <ExternalLink className="size-4" aria-hidden />
          </a>
        </div>
      </div>
    </section>
  );
}

function LiveStatus({ tournament }: { tournament: Tournament }) {
  const played = new Set(tournament.games.filter((game) => game.score != null).map((game) => game.round)).size;
  const last = [...tournament.games].sort((a, b) => b.round - a.round)[0];
  const waiting = tournament.awaitingPairing;
  return (
    <section className="rounded-2xl border border-line bg-surface px-5 py-4">
      <p className="text-sm font-medium tracking-wide text-pine uppercase">
        {waiting ? "Gaidām izlozi" : "Šodienas turnīrs"}
      </p>
      <p className="mt-2 text-lg">
        {waiting
          ? `Nākamā kārta vēl nav chess-results. Nospēlētas ${played}${tournament.roundsScheduled ? ` no ${tournament.roundsScheduled}` : ""} kārtām.`
          : `Visas ${tournament.roundsScheduled ?? played} kārtas ir nospēlētas. Nākamajā turnīrā te parādīsies galdiņš un krāsa.`}
      </p>
      {last ? (
        <p className="mt-2 text-sm text-muted">
          Pēdējā: {last.round}. kārta
          {last.board > 0 ? `, ${last.board}. galds` : ""}, {colorName(last.color).toLocaleLowerCase("lv")}, pret {last.opponent}.
          {tournament.lastRoundAt ? ` Publicēta ${tournament.lastRoundAt}.` : ""}
        </p>
      ) : null}
      <Neighbors tournament={tournament} />
    </section>
  );
}

function RoundNote({ dossier, tournament }: { dossier: Dossier; tournament: Tournament }) {
  const next = tournament.nextGame;
  if (next) {
    const played = priorGames(dossier, next.opponent);
    const bye = isBye(next.opponent);
    return (
      <p className="mb-3 text-sm">
        Nākamā: {next.round}. kārta, {next.board > 0 ? `${next.board}. galds` : "galds vēl nav zināms"},{" "}
        {colorName(next.color).toLocaleLowerCase("lv")}
        {bye ? ", brīva kārta" : ` pret ${next.opponent}`}.
        {bye ? "" : ` ${historyLine(played)}.`}
        {next.startsAt ? ` Sākums ${next.startsAt}.` : tournament.lastRoundAt ? ` Iepriekšējās kārtas sākums ${tournament.lastRoundAt}.` : ""}
      </p>
    );
  }
  if (tournament.awaitingPairing) {
    return <p className="mb-3 text-sm text-brass">Nākamā izloze vēl nav publicēta. Spied «Atjaunot».</p>;
  }
  return null;
}

function timeline(dossier: Dossier): Game[] {
  return [...dossier.tournaments]
    .sort((a, b) => (a.endDate < b.endDate ? -1 : a.endDate > b.endDate ? 1 : 0))
    .flatMap((tournament) => [...tournament.games].sort((a, b) => a.round - b.round));
}

function Charts({ dossier }: { dossier: Dossier }) {
  const games = useMemo(() => timeline(dossier), [dossier]);
  const today = dossier.tournaments.find((tournament) => dayStatus(tournament.endDate, dossier.today) === "today");
  if (games.length === 0 && !today) return null;
  return (
    <section>
      <SectionTitle title="Grafiki" hint="turnīri, bilance un krāsas" />
      <div className="grid gap-3 lg:grid-cols-2">
        <TournamentPoints dossier={dossier} />
        <TournamentShare dossier={dossier} />
        <TournamentResults dossier={dossier} />
        {today && today.games.length > 0 ? <RoundBars tournament={today} /> : null}
        <BalanceBar dossier={dossier} />
        <ColorSplit title="Spēlētās krāsas" hint="visas partijas" games={games} />
        <ColorRecord games={games} />
      </div>
    </section>
  );
}

function chartRows(dossier: Dossier): Tournament[] {
  return [...dossier.tournaments]
    .filter((tournament) => tournament.points != null || tournament.games.some((game) => game.score != null))
    .sort((a, b) => (a.endDate < b.endDate ? -1 : a.endDate > b.endDate ? 1 : 0));
}

function shortWhen(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}.${match[2]}` : "—";
}

function niceTop(value: number): number {
  if (value <= 1) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const step = value / exp;
  const nice = step <= 1 ? 1 : step <= 2 ? 2 : step <= 5 ? 5 : 10;
  return nice * exp;
}

function ScaleBars({
  caption,
  top,
  ticks,
  rows,
}: {
  caption: string;
  top: number;
  ticks: number[];
  rows: { id: string; name: string; date: string; label: string; amount: number; bar: ReactNode }[];
}) {
  const scale = Math.max(top, 1);
  return (
    <>
      <p className="mt-1 text-sm text-muted">{caption}</p>
      <div className="mt-3 flex gap-2">
        <div className="flex h-36 w-8 shrink-0 flex-col justify-between pt-4 text-right text-[10px] leading-none text-muted tabular-nums">
          {ticks.map((tick) => (
            <span key={tick}>{top === 100 ? `${tick}%` : Number.isInteger(tick) ? tick : tick.toFixed(1)}</span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative h-36 pt-4">
            <div className="pointer-events-none absolute inset-x-0 top-4 bottom-0 flex flex-col justify-between">
              {ticks.map((tick) => (
                <div key={tick} className="border-t border-line" />
              ))}
            </div>
            <div className="relative flex h-full items-end gap-1">
              {rows.map((row) => (
                <div key={row.id} className="flex h-full min-w-0 flex-1 items-end" title={row.name}>
                  <div className="relative w-full" style={{ height: `${Math.max(0, (row.amount / scale) * 100)}%` }}>
                    <span className="absolute bottom-full left-1/2 mb-0.5 -translate-x-1/2 text-[10px] leading-none tabular-nums whitespace-nowrap">
                      {row.label}
                    </span>
                    {row.bar}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-1 flex gap-1">
            {rows.map((row) => (
              <span key={row.id} className="min-w-0 flex-1 truncate text-center text-[10px] text-muted tabular-nums">
                {shortWhen(row.date)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function TournamentPoints({ dossier }: { dossier: Dossier }) {
  const rows = chartRows(dossier).filter((tournament) => tournament.points != null);
  if (rows.length === 0) return null;
  const top = niceTop(Math.max(...rows.map((tournament) => tournament.points ?? 0)));
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="text-xl">Punkti turnīros</h3>
      <ScaleBars
        caption="Katrs stabiņš ir viens turnīrs."
        top={top}
        ticks={[top, top / 2, 0]}
        rows={rows.map((tournament) => ({
          id: tournament.id,
          name: tournament.name,
          date: tournament.endDate,
          label: formatPoints(tournament.points),
          amount: tournament.points ?? 0,
          bar: <div className="h-full w-full rounded-sm bg-pine" />,
        }))}
      />
    </div>
  );
}

function TournamentShare({ dossier }: { dossier: Dossier }) {
  const rows = chartRows(dossier)
    .map((tournament) => {
      const cap = maxPoints(tournament);
      if (tournament.points == null || !cap) return null;
      return {
        id: tournament.id,
        name: tournament.name,
        date: tournament.endDate,
        share: tournament.points / cap.value,
        note: cap.playedOnly ? "no nospēlētajām" : "no kārtām",
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="text-xl">Punktu īpatsvars</h3>
      <ScaleBars
        caption="Punkti dalīti ar kārtu skaitu. Ja kārtas nav zināmas, ar nospēlētajām partijām. Mērogs 0–100%."
        top={100}
        ticks={[100, 50, 0]}
        rows={rows.map((row) => ({
          id: row.id,
          name: `${row.name}: ${row.note}`,
          date: row.date,
          label: `${Math.round(row.share * 100)}%`,
          amount: row.share * 100,
          bar: <div className="h-full w-full rounded-sm bg-pine" />,
        }))}
      />
    </div>
  );
}

function TournamentResults({ dossier }: { dossier: Dossier }) {
  const rows = chartRows(dossier)
    .map((tournament) => {
      const games = tournament.games.filter((game) => game.score != null);
      return {
        id: tournament.id,
        name: tournament.name,
        date: tournament.endDate,
        wins: games.filter((game) => game.result === "win").length,
        draws: games.filter((game) => game.result === "draw").length,
        losses: games.filter((game) => game.result === "loss").length,
      };
    })
    .filter((row) => row.wins + row.draws + row.losses > 0);
  const max = Math.max(1, ...rows.map((row) => row.wins + row.draws + row.losses));
  const top = niceTop(max);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="text-xl">Rezultāti turnīros</h3>
      <ScaleBars
        caption="Zaļš — uzvara, gaišs — neizšķirts, sarkans — zaudējums."
        top={top}
        ticks={[top, top / 2, 0]}
        rows={rows.map((row) => {
          const total = row.wins + row.draws + row.losses;
          return {
            id: row.id,
            name: row.name,
            date: row.date,
            label: String(total),
            amount: total,
            bar: (
              <div className="flex h-full w-full flex-col-reverse overflow-hidden rounded-sm">
                {row.wins > 0 ? <div className="bg-pine" style={{ flex: row.wins }} /> : null}
                {row.draws > 0 ? <div className="bg-pine-soft" style={{ flex: row.draws }} /> : null}
                {row.losses > 0 ? <div className="bg-loss" style={{ flex: row.losses }} /> : null}
              </div>
            ),
          };
        })}
      />
    </div>
  );
}

function RoundBars({ tournament }: { tournament: Tournament }) {
  const games = [...tournament.games].sort((a, b) => a.round - b.round);
  const scheduled = Math.max(tournament.roundsScheduled ?? 0, games.length, 1);
  const byRound = new Map(games.map((game) => [game.round, game]));
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="text-xl">Šodienas kārtas</h3>
      <div className="mt-4 flex h-24 items-end gap-1.5">
        {Array.from({ length: scheduled }, (_, index) => {
          const round = index + 1;
          const game = byRound.get(round);
          const score = game?.score;
          const height = score == null ? 8 : Math.max(8, score * 100);
          const cls = score == null ? "bg-line" : score >= 1 ? "bg-pine" : score > 0 ? "bg-pine-soft" : "bg-loss";
          return (
            <div key={round} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div className="flex h-16 w-full items-end">
                <div className={`w-full rounded-sm ${cls}`} style={{ height: `${height}%` }} title={game ? `${game.opponent}` : "vēl nav"} />
              </div>
              <span className="text-xs text-muted tabular-nums">{round}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-sm text-muted">Zaļš — uzvara, gaišs — neizšķirts, sarkans — zaudējums.</p>
    </div>
  );
}

function BalanceBar({ dossier }: { dossier: Dossier }) {
  const { wins, draws, losses, scored } = dossier.totals;
  const total = Math.max(scored, 1);
  const parts = [
    { label: "Uzvaras", value: wins, cls: "bg-pine" },
    { label: "Neizšķirti", value: draws, cls: "bg-pine-soft" },
    { label: "Zaudējumi", value: losses, cls: "bg-loss" },
  ];
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="text-xl">Bilance</h3>
      <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-bg-deep">
        {parts.map((part) =>
          part.value > 0 ? (
            <div key={part.label} className={part.cls} style={{ width: `${(part.value / total) * 100}%` }} />
          ) : null,
        )}
      </div>
      <ul className="mt-3 grid grid-cols-3 gap-2 text-sm">
        {parts.map((part) => (
          <li key={part.label}>
            <span className="block text-muted">{part.label}</span>
            <span className="font-medium tabular-nums">{part.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ColorRecord({ games }: { games: Game[] }) {
  const rows = (["white", "black"] as const)
    .map((color) => {
      const played = games.filter((game) => game.color === color && game.score != null);
      return { color, played: played.length, wins: played.filter((game) => game.result === "win").length };
    })
    .filter((row) => row.played > 0);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="text-xl">Uzvaras pēc krāsas</h3>
      <p className="mt-1 text-sm text-muted">Uzvaras no visām ar šo krāsu spēlētajām partijām.</p>
      <ul className="mt-4 grid gap-3">
        {rows.map((row) => (
          <li key={row.color}>
            <div className="mb-1 flex items-center justify-between gap-3 text-sm">
              <span className="inline-flex items-center gap-2">
                <Knight tone={row.color} className="size-5" />
                {row.color === "white" ? "Baltie" : "Melnie"}
              </span>
              <span className="tabular-nums">
                {row.wins} uzvaras no {row.played}
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-bg-deep">
              <div className="h-full bg-pine" style={{ width: `${(row.wins / row.played) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ColorSplit({ title, hint, games }: { title: string; hint: string; games: Game[] }) {
  const total = games.length;
  const counts = {
    white: games.filter((game) => game.color === "white").length,
    black: games.filter((game) => game.color === "black").length,
    unknown: games.filter((game) => game.color === "unknown").length,
  };
  const parts = [
    { key: "white" as const, label: "Baltie", value: counts.white, cls: "bg-white shadow-[inset_0_0_0_1px_#1e4a38]" },
    { key: "black" as const, label: "Melnie", value: counts.black, cls: "bg-pine" },
    { key: "unknown" as const, label: "Krāsa nav norādīta", value: counts.unknown, cls: "bg-line" },
  ];
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="text-xl">{title}</h3>
      <p className="mt-1 text-sm text-muted">
        {hint} · {total}
      </p>
      <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-bg-deep">
        {parts.map((part) =>
          part.value > 0 ? (
            <div key={part.key} className={part.cls} style={{ width: `${total ? (part.value / total) * 100 : 0}%` }} />
          ) : null,
        )}
      </div>
      <ul className="mt-3 grid gap-2 text-sm">
        {parts
          .filter((part) => part.key !== "unknown" || part.value > 0)
          .map((part) => (
            <li key={part.key} className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2">
                {part.key === "unknown" ? (
                  <span className="size-5 rounded-sm bg-line" />
                ) : (
                  <Knight tone={part.key} className="size-5" />
                )}
                {part.label}
              </span>
              <span className="tabular-nums">
                {part.value}
                <span className="text-muted"> no {total}</span>
              </span>
            </li>
          ))}
      </ul>
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
  if (tournament.points != null) bits.push(`${formatPoints(tournament.points)} punkti`);
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
          <span key={index} className={`grid place-items-center ${light ? "bg-white" : "bg-[#1e4a38]"}`}>
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
    <p className={`text-sm ${light ? "mt-2 text-pine-soft" : "mb-3 text-muted"}`}>
      {rows.above ? `Virs: ${rows.above.rank}. ${rows.above.name} (${formatPoints(rows.above.points)})` : "Neviens nav virs"}
      {" · "}
      {rows.below ? `Zem: ${rows.below.rank}. ${rows.below.name} (${formatPoints(rows.below.points)})` : "Neviens nav zem"}
    </p>
  );
}

function RoundLine({ games }: { games: Game[] }) {
  const rows = [...games].sort((a, b) => a.round - b.round);
  if (rows.length === 0) return null;
  return (
    <div className="mb-3">
      <p className="mb-2 text-sm text-muted">Partiju rezultāti</p>
      <ol className="flex gap-1.5 overflow-x-auto pb-1">
        {rows.map((game) => {
          const mark = game.score == null ? "—" : game.score >= 1 ? "1" : game.score > 0 ? "½" : "0";
          const tone =
            game.score == null
              ? "bg-bg-deep text-muted"
              : game.score >= 1
                ? "bg-pine-soft text-pine"
                : game.score > 0
                  ? "bg-bg-deep text-ink"
                  : "bg-loss/15 text-loss";
          return (
            <li
              key={`${game.round}-${game.opponent}`}
              className={`grid h-12 w-9 shrink-0 grid-rows-2 place-items-center rounded-lg text-center tabular-nums ${tone}`}
              title={game.opponent}
            >
              <span className="text-[10px] leading-none text-muted">{game.round}</span>
              <span className="text-sm leading-none font-medium">{mark}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function summaryText(dossier: Dossier): string {
  const tournament = dossier.tournaments.find((item) => item.endDate === dossier.today) ?? dossier.tournaments[0];
  if (!tournament) return "Nav turnīru.";
  const played = tournament.games.filter((game) => game.score != null).length;
  const when = tournament.endDate === dossier.today ? " šodien" : ` ${formatDate(tournament.endDate)}`;
  const lines = [
    `${DISPLAY_NAME}${when}: ${formatPoints(tournament.points)} punkti${played ? ` no ${played} partijām` : ""}.`,
  ];
  if (tournament.rank) lines.push(`${tournament.rank}. vieta${tournament.fieldSize ? ` no ${tournament.fieldSize}` : ""}.`);
  const next = tournament.nextGame;
  if (next) {
    const played = priorGames(dossier, next.opponent);
    lines.push(
      `Nākamā: ${next.round}. kārta, ${next.board > 0 ? `${next.board}. galds, ` : ""}${colorName(next.color).toLocaleLowerCase("lv")} pret ${next.opponent}. ${historyLine(played)}.`,
    );
    if (next.startsAt) lines.push(`Sākums ${next.startsAt}.`);
  } else if (tournament.lastRoundAt) {
    lines.push(`Iepriekšējā kārta publicēta ${tournament.lastRoundAt}.`);
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
  return (
    <div className="border-t border-white/20 bg-pine text-white">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2 sm:px-6">
        <MiniBoard color={next.color} className="size-12 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {next.round}. kārta · {next.board > 0 ? `${next.board}. galds` : "galds nav zināms"} · {colorName(next.color).toLocaleLowerCase("lv")}
          </p>
          <p className="truncate">
            pret {isBye(next.opponent) ? "brīvu kārtu" : next.opponent}
          </p>
          <p className="truncate text-sm text-pine-soft">
            {isBye(next.opponent)
              ? placeLine(tournament)
              : `${historyLine(priorGames(dossier, next.opponent))} · ${placeLine(tournament)}`}
          </p>
          <Neighbors tournament={tournament} light />
        </div>
        <CopySummary dossier={dossier} compact />
      </div>
    </div>
  );
}

