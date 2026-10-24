import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  Bell,
  BellOff,
  ExternalLink,
  MapPin,
  RefreshCw,
  Search,
  Sun,
  Moon,
  Copy,
  Trophy,
  ChevronDown,
  CalendarDays,
  Users,
  BarChart3,
} from "lucide-react";
import { Knight } from "@/components/knight";
import {
  ALERT_KEY,
  freshPairings,
  pairingBody,
  pairingKeys,
  rememberPairings,
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

import { safeStorage } from "@/lib/storage";
import { paceOf, scopedDossier, scoreRate } from "@/lib/chess/stats";

const DISPLAY_NAME = "Valters Avotiņš";

type AlertState = {
  enabled: boolean;
  note: string;
  toggle: () => void;
};

function usePairingAlerts(dossier: Dossier | null): AlertState {
  const [enabled, setEnabled] = useState(false);
  const [note, setNote] = useState("");
  const signature = dossier ? pairingKeys(dossier).join("\n") : "";

  useEffect(() => {
    if (typeof window === "undefined" || typeof Notification === "undefined") return;
    setEnabled(safeStorage.get(ALERT_KEY) === "1" && Notification.permission === "granted");
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

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
    let permission: NotificationPermission;
    try { permission = await Notification.requestPermission(); }
    catch { setNote("Pārlūks neatļāva paziņojumu pieprasījumu."); return; }
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
    setNote("Ieslēgts. Paziņojumi darbojas, kamēr lapa ir aktīva. Bloķētā telefonā pārbaudes var apstāties.");
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
        <p className="mt-4 max-w-md text-lg text-muted">Nolasa turnīrus un partijas no chess-results.com. Pirmajā reizē tas var aizņemt dažas minūtes: avotu pārbaudām saudzīgi, secīgi un ar pauzēm.</p>
      </div>
    </Shell>
  );
}

export function ValtersApp({ initial }: { initial: LoadResult }) {
  const [result, setResult] = useState(initial);
  const [loading, setLoading] = useState(false);

  const inFlight = useRef<Promise<void> | null>(null);
  const lastAttempt = useRef(0);
  const refreshQuiet = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    lastAttempt.current = Date.now();
    inFlight.current = (async () => {
    try {
      const next = await getDossier({ data: { refresh: true } });
      setResult(current => !next.ok && current.ok ? { ...current, stale: true, warning: next.error, dossier: { ...current.dossier, nextCheckAt: next.nextCheckAt || new Date(Date.now() + 900_000).toISOString() } } : next);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Neizdevās atjaunot.";
      setResult((current) =>
        current.ok
          ? { ...current, stale: true, warning: message, dossier: { ...current.dossier, nextCheckAt: new Date(Date.now() + 900_000).toISOString() } }
          : { ok: false, error: message, nextCheckAt: new Date(Date.now() + 900_000).toISOString() },
      );
    }
    })().finally(() => { inFlight.current = null; });
    return inFlight.current;
  }, []);

  const nextCheckAt = result.ok ? result.dossier.nextCheckAt : result.nextCheckAt;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      clearTimeout(timer);
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      const due = Math.max(new Date(nextCheckAt || 0).getTime(), lastAttempt.current + 60_000);
      if (Date.now() >= due) void refreshQuiet();
      else timer = setTimeout(check, Math.min(due - Date.now() + 1000, 2_147_000_000));
    };
    check();
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", check); window.removeEventListener("online", check); };
  }, [nextCheckAt, refreshQuiet]);

  async function refresh() {
    setLoading(true);
    try {
      await refreshQuiet();
    } finally {
      setLoading(false);
    }
  }

  const alerts = usePairingAlerts(result.ok ? result.dossier : null);
  if (!result.ok) {
    return (
      <Shell>
        <div className="mx-auto max-w-xl px-5 py-20">
          <p className="text-sm font-medium text-pine">chess-results.com</p>
          <h1 className="mt-2 text-4xl">{DISPLAY_NAME}</h1>
          <p role="alert" className="mt-4 text-lg text-muted">{result.error}</p>
          {result.nextCheckAt ? <p className="mt-3 text-sm text-muted">Avotu varēs pārbaudīt pēc {formatStamp(result.nextCheckAt)}.</p> : null}
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
      <TopBar dossier={result.dossier} loading={loading} onRefresh={refresh} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {result.warning ? (
          <p role="status" className="mb-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-brass">
            {result.warning}
          </p>
        ) : null}
        {result.dossier.partialNote ? (
          <p className="mb-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">
            {result.dossier.partialNote}
          </p>
        ) : null}
        <NextGames dossier={result.dossier} />
        <Board dossier={result.dossier} alerts={alerts} />
      </main>
      <footer className="mx-auto max-w-6xl px-4 pt-4 pb-10 text-sm text-muted sm:px-6">
        Dati tikai no{" "}
        <a className="underline decoration-line underline-offset-4" href="https://chess-results.com/" target="_blank" rel="noreferrer">
          chess-results.com
        </a>
        . FIDE {result.dossier.player.fideId}
        {result.dossier.player.rating ? ` · ${result.dossier.player.rating}` : " · nav reitinga"}. Aktīva lapa pārbauda datus ne biežāk kā reizi 5 minūtēs. Poga Atjaunot ievēro to pašu avota aizturi.
      </footer>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return (
    <div data-hydrated={hydrated} className="relative z-0 min-h-screen text-ink">
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
}: {
  dossier: Dossier;
  loading: boolean;
  onRefresh: () => void;
}) {
  const [dark, setDark] = useState(false);
  const [showDock, setShowDock] = useState(false);
  const [now, setNow] = useState(() => Date.parse(dossier.fetchedAt));
  useEffect(() => { setNow(Date.now()); const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  const remaining = Math.max(0, Math.ceil((new Date(dossier.nextCheckAt).getTime() - now) / 60_000));
  useEffect(() => {
    const hero = document.querySelector("[data-next-game]");
    if (!hero) { setShowDock(false); return; }
    const observer = new IntersectionObserver(([entry]) => setShowDock(!entry.isIntersecting && entry.boundingClientRect.bottom < 0));
    observer.observe(hero);
    return () => observer.disconnect();
  }, [dossier]);
  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark");
  }, []);
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "dark" ? "" : "dark";
    if (next) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    safeStorage.set("valters-theme", next ? "dark" : "light");
    setDark(Boolean(next));
  }
  const live = dossier.tournaments.find((tournament) => tournament.nextGame);
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white/95">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
        <Knight tone="white" className="size-10 shrink-0 rounded-lg bg-pine p-0.5" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{DISPLAY_NAME}</p>
          <p className="truncate text-sm text-muted">Atjaunots {formatStamp(dossier.fetchedAt)}</p>

        </div>
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={dark ? "Ieslēgt gaišo režīmu" : "Ieslēgt tumšo režīmu"}
          title={dark ? "Gaišais režīms" : "Tumšais režīms"}
          aria-pressed={dark}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center gap-2 rounded-full border border-line bg-surface font-medium sm:w-auto sm:px-4"
        >
          {dark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
          <span className="hidden sm:inline">{dark ? "Gaišs" : "Tumšs"}</span>
        </button>
        <button
          type="button"
          onClick={onRefresh}
          aria-label={loading ? "Atjauno" : "Atjaunot"}
          disabled={loading || remaining > 0}
          title={remaining > 0 ? `Avota aizsardzība: nākamā pārbaude pēc ~${remaining} min` : "Pārbaudīt avotu"}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center gap-2 rounded-full bg-pine font-medium text-white disabled:opacity-60 sm:w-auto sm:px-5"
        >
          <RefreshCw className={loading ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} />
          <span className="hidden sm:inline">{loading ? "Atjauno" : "Atjaunot"}</span>
        </button>
      </div>
      <p className="mx-auto max-w-6xl px-4 pb-2 text-xs text-muted sm:px-6" role="status">{remaining ? `Nākamā pārbaude pēc ~${remaining} min` : "Var pārbaudīt avotu"}</p>
      {live && showDock ? <LiveDock dossier={dossier} tournament={live} /> : null}
    </header>
  );
}

function Overview({ dossier, alerts }: { dossier: Dossier; alerts: AlertState }) {
  const { totals, player } = dossier;
  const stats = [
    { label: "Turnīri", value: String(totals.tournaments) },
    { label: "Nospēlētas partijas", value: String(totals.games) },
    { label: "Punkti", value: formatPoints(totals.score) },
    { label: "Uzvaras · neizšķirti · zaudējumi", value: `${totals.wins}–${totals.draws}–${totals.losses}` },
  ];
  return (
    <section aria-label="Spēlētāja kopsavilkums" className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(stat => <div key={stat.label} className="rounded-2xl border border-line bg-surface p-4">
          <p className="text-sm text-muted">{stat.label}</p>
          <p className="mt-2 font-display text-3xl text-pine tabular-nums">{stat.value}</p>
        </div>)}
      </div>
      <details className="rounded-2xl border border-line bg-surface p-4">
        <summary className="cursor-pointer font-medium">Profils un paziņojumi <span className="font-normal text-muted">· FIDE {player.fideId}</span></summary>
        <p className="mt-3 text-sm text-muted">{player.rating ? `Turnīra reitings ${player.rating}` : "Nav reitinga"}{player.club ? ` · ${player.club}` : ""}. Gaidāmas partijas: {totals.pending}.</p>
        <button type="button" onClick={() => void alerts.toggle()} aria-pressed={alerts.enabled} className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-full border border-line px-4">
          {alerts.enabled ? <BellOff className="size-4" aria-hidden /> : <Bell className="size-4" aria-hidden />}
          {alerts.enabled ? "Izslēgt paziņojumus" : "Paziņojumi aktīvā lapā"}
        </button>
        <p role="status" className="mt-2 max-w-xl text-sm text-muted">{alerts.note || "Pārbaude ne biežāk kā reizi 5 minūtēs, kamēr lapa ir aktīva. Bloķētā telefonā vai aizvērtā lapā paziņojumi nav garantēti."}</p>
        <CopySummary dossier={dossier} />
      </details>
    </section>
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

function Board({ dossier, alerts }: { dossier: Dossier; alerts: AlertState }) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("tournaments");
  const [onlyRepeats, setOnlyRepeats] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [year, setYear] = useState("all");
  const [pace, setPace] = useState("all");
  const needle = query.trim();
  const years = useMemo(() => {
    const found = new Set(dossier.tournaments.map((tournament) => tournament.endDate.slice(0, 4)).filter(Boolean));
    return [...found].sort((a, b) => (a < b ? 1 : -1));
  }, [dossier.tournaments]);

  const scoped = useMemo(() => {
    return dossier.tournaments.filter((tournament) => {
      if (year !== "all" && !tournament.endDate.startsWith(year)) return false;
      if (pace !== "all" && paceOf(tournament.timeControl) !== pace) return false;
      return true;
    });
  }, [dossier.tournaments, year, pace]);

  const filteredDossier = useMemo(() => scopedDossier(dossier, scoped), [dossier, scoped]);
  const scopedOpponents = filteredDossier.opponents;

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

  const visibleOpponents = onlyRepeats ? opponents.filter(o => o.games > 1) : opponents;

  return (
    <div className="mt-8 grid gap-8">
      <nav aria-label="Sadaļas" className="grid grid-cols-3 gap-1 rounded-2xl border border-line bg-surface p-1">
        {[{key:"tournaments",label:"Turnīri",icon:CalendarDays},{key:"opponents",label:"Pretinieki",icon:Users},{key:"stats",label:"Statistika",icon:BarChart3}].map(item => <button key={item.key} type="button" aria-pressed={tab === item.key} onClick={() => setTab(item.key)} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-2 text-sm font-medium ${tab === item.key ? "bg-pine text-white" : "text-muted"}`}><item.icon className="hidden size-4 sm:block" aria-hidden />{item.label}</button>)}
      </nav>
      <div className="grid gap-3">
        <label className="search-field flex h-14 items-center gap-3 rounded-full border border-line bg-white px-4">
          <Search className="size-5 text-muted" aria-hidden />
          <input
            aria-label="Meklēt pretinieku, klubu vai turnīru"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Meklēt pretinieku, klubu vai turnīru"
            autoComplete="off"
            enterKeyHint="search"
            className="w-full bg-transparent text-base outline-none placeholder:text-muted"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <FilterChip pressed={year === "all"} onClick={() => setYear("all")}>
            Visi gadi
          </FilterChip>
          {years.map((item) => (
            <FilterChip key={item} pressed={year === item} onClick={() => setYear(item)}>
              {item}
            </FilterChip>
          ))}
          <FilterChip pressed={pace === "all"} onClick={() => setPace("all")}>
            Visi tempi
          </FilterChip>
          <FilterChip pressed={pace === "rapid"} onClick={() => setPace("rapid")}>
            Rapids
          </FilterChip>
          <FilterChip pressed={pace === "blitz"} onClick={() => setPace("blitz")}>Blics</FilterChip>
          <FilterChip pressed={pace === "classical"} onClick={() => setPace("classical")}>Klasiskais</FilterChip>
          <FilterChip pressed={pace === "unknown"} onClick={() => setPace("unknown")}>Nezināms temps</FilterChip>
          {year !== "all" || pace !== "all" || query ? <button className="min-h-12 px-3 text-sm underline" onClick={() => { setYear("all"); setPace("all"); setQuery(""); }}>Notīrīt filtrus</button> : null}
        </div>
        {needle ? (
          <p className="px-4 text-sm text-muted">
            {tournaments.length === 1 ? "1 turnīrs" : `${tournaments.length} turnīri`} ·{" "}
            {opponents.length === 1 ? "1 pretinieks" : `${opponents.length} pretinieki`}
          </p>
        ) : null}
      </div>

      <Overview dossier={filteredDossier} alerts={alerts} />

      {tab === "stats" ? <Charts dossier={filteredDossier} /> : null}
      {tab === "tournaments" ? <section aria-label="Turnīri">
        <SectionTitle title="Turnīri" hint={`${tournaments.length} no ${dossier.tournaments.length}`} />
        {tournaments.length === 0 ? (
          <Empty>Nav turnīru, kas atbilst meklējumam.</Empty>
        ) : (
          <div className="grid gap-3">
            {tournaments.map(({ tournament, games }, index) => (
              <TournamentCard
                key={tournament.id}
                tournament={tournament}
                games={games}
                today={dossier.today}
                startOpen={Boolean(needle) || (index === 0 && !needle)}
              />
            ))}
          </div>
        )}
      </section> : null}

      {tab === "opponents" ? <section aria-label="Pretinieki">
        <div className="mb-4"><FilterChip pressed={onlyRepeats} onClick={() => setOnlyRepeats(!onlyRepeats)}>Tikai atkārtotie pretinieki</FilterChip></div>
        <SectionTitle title="Pretinieki" hint={needle ? `${opponents.length} atbilst` : "cik reižu un kā veicies"} />
        {visibleOpponents.length === 0 ? (
          <Empty>{needle ? "Nav pretinieku, kas atbilst meklējumam." : "Vēl nav pretinieku šajos turnīros."}</Empty>
        ) : (
          <ul className="grid gap-2">
            {visibleOpponents.map((opponent) => (
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
        )}
      </section> : null}
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

function TournamentCard({
  tournament,
  today,
  startOpen,
  games,
}: {
  tournament: Tournament;
  today: string;
  startOpen: boolean;
  games: Game[];
}) {
  const status = dayStatus(tournament.endDate, today, tournament.startDate);
  const badge = status === "live" ? "Notiek" : status === "today" ? "Šodien" : status === "upcoming" ? "Gaidāms" : null;
  const medal = tournament.rank != null && tournament.rank >= 1 && tournament.rank <= 3;
  const [opened, setOpened] = useState(startOpen);
  useEffect(() => {
    setOpened(startOpen);
  }, [startOpen]);
  return (
    <article className={`relative min-w-0 rounded-2xl border-2 bg-surface ${scoreBorder(tournament)}`}>
      <details className="group" open={opened} onToggle={(event) => setOpened(event.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 pr-6">
              {badge ? (
                <span className="rounded-full bg-pine px-2 py-0.5 text-xs font-medium text-white">{badge}</span>
              ) : null}
              {medal ? (
                <span className="rounded-full bg-pine-soft px-2 py-0.5 text-xs font-medium text-pine">
                  {status === "live" || status === "today" ? "Pašlaik " : ""}{tournament.rank}. vieta
                </span>
              ) : null}
              <h3 className="text-xl">{tournament.name}</h3>
            </div>
            <p className="mt-1 text-sm text-muted">
              <span className="tabular-nums">{formatDate(tournament.endDate)}</span>
              {tournament.location ? (
                <span className="mt-1 flex items-start gap-1">
                  <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0 break-words">{tournament.location}</span>
                </span>
              ) : null}
            </p>
          </div>
          <ChevronDown className="absolute top-5 right-4 size-5 text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
          <dl className="flex gap-4 text-sm tabular-nums sm:text-right">
            <div>
              <dt className="text-muted">Punkti</dt>
              <dd className="text-lg font-medium">{formatPoints(tournament.points)}</dd>
            </div>
            <div>
              <dt className="text-muted">Vieta</dt>
              <dd className="text-lg font-medium">
                {tournament.rank ?? "—"}
                {tournament.fieldSize ? <span className="text-muted">/{tournament.fieldSize}</span> : null}
              </dd>
            </div>
          </dl>
        </summary>
        <div className="border-t border-line px-4 py-4 sm:px-5">
          <div className="mb-4 grid gap-1 text-sm text-muted">
            {tournament.timeControl ? <p className="break-words">{tournament.timeControl}</p> : null}
            {tournament.performance ? <p>Performance {tournament.performance}</p> : null}
            {tournament.organizer ? <p className="break-words">{tournament.organizer}</p> : null}
            {tournament.lastUpdate ? <p>Lapā: {tournament.lastUpdate}</p> : null}
          </div>
          <Neighbors tournament={tournament} />
          {tournament.partial ? (
            <p className="text-sm text-brass">Partiju sarakstu šoreiz neizdevās nolasīt.</p>
          ) : (
            <>
              <RoundNote tournament={tournament} />
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
    <ol className="grid gap-2">
      {games.map((game) => (
        <li
          key={`${game.tournamentId}-${game.round}-${game.opponent}`}
          className="grid grid-cols-[1.25rem_2rem_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[2.5rem_2.75rem_1fr_auto] sm:gap-3 rounded-xl bg-bg px-3 py-3"
        >
          <span className="text-sm text-muted tabular-nums">{game.round}.</span>
          <PieceMark color={game.color} />
          <span className="min-w-0">
            <span className="block break-words font-medium">{game.opponent}</span>
            <span className="block truncate text-sm text-muted">
              {colorName(game.color).toLocaleLowerCase("lv")}
              {game.board > 0 ? ` · ${game.board}. galds` : ""}
              {game.opponentClub ? ` · ${game.opponentClub}` : ""}
            </span>
          </span>
          <ResultMark result={game.result} />
        </li>
      ))}
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
  const percent = opponent.scored ? Math.round((opponent.score / opponent.scored) * 100) : null;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onSelect}
      className={
        "flex w-full items-center gap-3 rounded-2xl border px-4 py-4 text-left motion-reduce:transition-none " +
        (pressed ? "border-pine bg-pine-soft" : opponent.games > 1 ? "border-pine bg-surface" : "border-line bg-surface")
      }
    >
      <span className="grid size-12 shrink-0 place-items-center rounded-full bg-bg-deep text-sm font-medium">
        {initials(opponent.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">
          {opponent.name}
          {opponent.games > 1 ? <span className="text-muted"> · {opponent.games}×</span> : null}
        </span>
        <span className="block truncate text-sm text-muted">{opponent.club || opponent.fed}{opponent.pending ? ` · ${opponent.pending} gaidāma` : ""}</span>
      </span>
      <span className="text-right">
        <span className="block font-medium tabular-nums">
          {opponent.wins}–{opponent.draws}–{opponent.losses}
        </span>
        <span className="block text-sm text-muted tabular-nums">{formatPoints(opponent.score)} · {percent == null ? "vēl nav rezultāta" : `${percent}%`}</span>
      </span>
    </button>
  );
}

function Meetings({ opponent }: { opponent: Opponent }) {
  return (
    <div className="mt-3 rounded-2xl border border-pine bg-surface p-4">
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
  if (color === "unknown") return <span className="size-8 shrink-0 sm:size-11" />;
  const white = color === "white";
  return (
    <span
      className={
        "grid size-8 shrink-0 sm:size-11 place-items-center rounded-md " +
        (white ? "bg-pine" : "piece-light border border-line bg-white")
      }
    >
      <Knight tone={white ? "white" : "black"} className="size-7 sm:size-10" />
    </span>
  );
}

function ResultMark({ result }: { result: GameResult }) {
  const view = {
    win: { label: "1", name: "Uzvara", cls: "bg-pine-soft text-pine" },
    draw: { label: "½", name: "Neizšķirts", cls: "bg-bg-deep text-brass" },
    loss: { label: "0", name: "Zaudējums", cls: "bg-bg-deep text-loss" },
    unknown: { label: "–", name: "Nav rezultāta", cls: "bg-bg-deep text-muted" },
  }[result];
  return (
    <span
      title={view.name}
      aria-label={view.name}
      className={`grid size-9 place-items-center rounded-full text-sm font-medium tabular-nums ${view.cls}`}
    >
      {view.label}
    </span>
  );
}

function liveTournaments(dossier: Dossier): Tournament[] {
  return dossier.tournaments.filter((tournament) => ["today", "live"].includes(dayStatus(tournament.endDate, dossier.today, tournament.startDate)) || tournament.nextGame || tournament.awaitingPairing);
}

function NextGames({ dossier }: { dossier: Dossier }) {
  const cards = liveTournaments(dossier);
  if (cards.length === 0) return null;
  return (
    <div className="mb-6 grid gap-3">
      {cards.map((tournament) =>
        tournament.nextGame ? (
          <NextGameBanner key={tournament.id} tournament={tournament} dossier={dossier} />
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

function NextGameBanner({ tournament, dossier }: { tournament: Tournament; dossier: Dossier }) {
  const next = tournament.nextGame;
  if (!next) return null;
  return (
    <section data-next-game aria-label="Nākamā partija" className="overflow-hidden rounded-3xl bg-pine text-white">
      <div className="grid sm:grid-cols-[8.5rem_1fr]">
        <div className="hidden place-items-center bg-white px-4 py-5 sm:grid">
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
          <p className="mt-4 break-words text-xl font-medium">pret {next.opponent}</p>
          {next.opponentRating ? <p className="mt-1 text-sm text-pine-soft">Pretinieka reitings {next.opponentRating}</p> : null}
          <p className="mt-1 text-sm text-pine-soft">
            {tournament.location ? `${tournament.location} · ` : ""}{placeLine(tournament)}
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
          <div className="mt-2"><CopySummary dossier={dossier} compact /></div>
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

function RoundNote({ tournament }: { tournament: Tournament }) {
  const next = tournament.nextGame;
  if (next) {
    return (
      <p className="mb-3 text-sm">
        Nākamā: {next.round}. kārta, {next.board > 0 ? `${next.board}. galds` : "galds vēl nav zināms"}, {colorName(next.color).toLocaleLowerCase("lv")} pret {next.opponent}.
        {next.startsAt ? ` Sākums ${next.startsAt}.` : tournament.lastRoundAt ? ` Iepriekšējās kārtas sākums ${tournament.lastRoundAt}.` : ""}
      </p>
    );
  }
  if (tournament.awaitingPairing) {
    return <p className="mb-3 text-sm text-brass">Nākamā izloze vēl nav publicēta. Lapa pārbaudīs avotu pēc aiztures.</p>;
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
  const today = liveTournaments(dossier)[0];

  return (
    <section>
      <SectionTitle title="Grafiki" hint="šodiena, bilance un krāsas" />
      <div className="grid gap-3 lg:grid-cols-2">
        {today && today.games.length > 0 ? <RoundBars tournament={today} /> : null}
        <BalanceBar dossier={dossier} />
        <ColorSplit title="Krāsas" hint="visas partijas" games={games} />
        <ColorPerformance games={games} />
        <TournamentTrend tournaments={dossier.tournaments} />
      </div>
    </section>
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

function ColorSplit({ title, hint, games }: { title: string; hint: string; games: Game[] }) {
  games = games.filter(g => g.score != null);
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

function scoreBorder(tournament: Tournament): string {
  const played = tournament.games.filter((game) => game.score != null).length;
  if (!played || tournament.points == null) return "border-line";
  const rate = tournament.points / played;
  if (rate > 0.5) return "border-pine";
  if (rate < 0.5) return "border-loss";
  return "border-line";
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
          <span key={index} className={`grid place-items-center ${light ? "piece-light bg-white" : "bg-[#1e4a38]"}`}>
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
  let sum = 0;
  return (
    <ol className="mb-4 flex gap-2 overflow-x-auto pb-1">
      {rows.map((game) => {
        if (game.score != null) sum += game.score;
        const cls = game.score == null ? "bg-line" : game.score >= 1 ? "bg-pine" : game.score > 0 ? "bg-pine-soft" : "bg-loss";
        const total = game.score == null ? null : sum;
        return (
          <li key={`${game.round}-${game.opponent}`} className="grid min-w-9 justify-items-center gap-1 text-xs text-muted tabular-nums">
            <span className={`h-2 w-full rounded-sm ${cls}`} />
            <span>{game.round}</span>
            <span className="text-ink">{formatPoints(total)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function summaryText(dossier: Dossier): string {
  const tournament = liveTournaments(dossier)[0] ?? dossier.tournaments[0];
  if (!tournament) return "Nav turnīru.";
  const played = tournament.games.filter((game) => game.score != null).length;
  const when = tournament.endDate === dossier.today ? " šodien" : ` ${formatDate(tournament.endDate)}`;
  const lines = [
    `${DISPLAY_NAME}${when}: ${formatPoints(tournament.points)} punkti${played ? ` no ${played} partijām` : ""}.`,
  ];
  if (tournament.rank) lines.push(`${tournament.rank}. vieta${tournament.fieldSize ? ` no ${tournament.fieldSize}` : ""}.`);
  const next = tournament.nextGame;
  if (next) {
    lines.push(
      `Nākamā: ${next.round}. kārta, ${next.board > 0 ? `${next.board}. galds, ` : ""}${colorName(next.color).toLocaleLowerCase("lv")} pret ${next.opponent}.`,
    );
    if (next.startsAt) lines.push(`Sākums ${next.startsAt}.`);
  } else if (tournament.lastRoundAt) {
    lines.push(`Iepriekšējās kārtas sākums ${tournament.lastRoundAt}.`);
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
      onClick={() => void copy()}
      className={
        compact
          ? "inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-white/15 px-3 text-sm font-medium"
          : "mt-4 inline-flex h-12 items-center gap-2 rounded-full border border-line px-4 font-medium"
      }
    >
      <Copy className="size-4" aria-hidden />
      {done ? "Nokopēts" : "Kopēt"}
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
          <p className="truncate">pret {next.opponent}</p>
          <p className="truncate text-sm text-pine-soft">
            {placeLine(tournament)}
            {next.startsAt ? ` · sākums ${next.startsAt}` : tournament.lastRoundAt ? ` · iepriekšējā ${tournament.lastRoundAt}` : ""}
          </p>
        </div>
        <CopySummary dossier={dossier} compact />
      </div>
    </div>
  );
}



function ColorPerformance({ games }: { games: Game[] }) {
  return <div className="rounded-2xl border border-line bg-surface p-4">
    <h3 className="text-xl">Punktu procents pēc krāsas</h3>
    <p className="mt-1 text-sm text-muted">Iegūtie punkti no iespējamajiem; tikai nospēlētas partijas.</p>
    <div className="mt-4 grid gap-4">{(["white", "black"] as const).map(color => {
      const rows = games.filter(g => g.color === color && g.score != null);
      const rate = scoreRate(rows);
      return <div key={color}><p className="mb-2 flex justify-between text-sm"><span>{colorName(color)} · {rows.length} partijas</span><span>{rate == null ? "—" : `${rate}%`}</span></p><div className="h-3 overflow-hidden rounded-full bg-bg-deep"><div className="h-full rounded-full bg-pine" style={{ width: `${rate || 0}%` }} /></div></div>;
    })}</div>
  </div>;
}
function TournamentTrend({ tournaments }: { tournaments: Tournament[] }) {
  const rows = [...tournaments].reverse().filter(t => t.games.some(g => g.score != null));
  return <div className="rounded-2xl border border-line bg-surface p-4 lg:col-span-2">
    <h3 className="text-xl">Rezultātu tendence pa turnīriem</h3>
    {rows.length ? <ol className="mt-4 grid gap-4 sm:grid-cols-2">{rows.map(t => {
      const rate = scoreRate(t.games);
      return <li key={t.id}><p className="text-sm font-medium">{t.name}</p><p className="mt-1 text-sm text-muted">{formatDate(t.endDate)} · {rate}% no iespējamajiem punktiem</p><div className="mt-2 h-2 rounded-full bg-bg-deep"><div className="h-full rounded-full bg-pine" style={{width:`${rate || 0}%`}} /></div></li>;
    })}</ol> : <p className="mt-3 text-sm text-muted">Šajos filtros vēl nav nospēlētu partiju.</p>}
  </div>;
}
