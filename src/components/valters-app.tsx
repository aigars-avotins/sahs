import { useCallback, useEffect, useMemo, useState } from "react";
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
    setNote("Ieslēgts. Kamēr lapa ir atvērta, telefons paziņos un iezvanīs par jaunu galdiņu.");
  }

  return { enabled, note, toggle };
}

const NOTES_KEY = "valters-notes";

function noteId(game: Game): string {
  return `${game.tournamentId}:${game.round}:${game.opponent}`;
}

function useNotes(): { notes: Record<string, string>; save: (id: string, text: string) => void } {
  const [notes, setNotes] = useState<Record<string, string>>({});
  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(NOTES_KEY) || "{}") as Record<string, string>;
      if (parsed && typeof parsed === "object") setNotes(parsed);
    } catch {
      setNotes({});
    }
  }, []);
  function save(id: string, text: string) {
    setNotes((current) => {
      const next = { ...current };
      const trimmed = text.trim();
      if (trimmed) next[id] = trimmed;
      else delete next[id];
      localStorage.setItem(NOTES_KEY, JSON.stringify(next));
      return next;
    });
  }
  return { notes, save };
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
  const notes = useNotes();

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
      <TopBar dossier={result.dossier} loading={loading} onRefresh={refresh} />
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
        <InstallHint />
        <Overview dossier={result.dossier} alerts={alerts} />
        <NextGames dossier={result.dossier} />
        <Charts dossier={result.dossier} />
        <Records dossier={result.dossier} />
        <Board dossier={result.dossier} notes={notes} />
      </main>
      <footer className="mx-auto max-w-6xl px-4 pt-4 pb-10 text-sm text-muted sm:px-6">
        Dati tikai no{" "}
        <a className="underline decoration-line underline-offset-4" href="https://chess-results.com/" target="_blank" rel="noreferrer">
          chess-results.com
        </a>
        . FIDE {result.dossier.player.fideId}. Atsvaidzini turnīra laikā ar pogu Atjaunot.
      </footer>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative z-0 min-h-screen text-ink">
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
          aria-pressed={dark}
          className="inline-flex h-12 items-center gap-2 rounded-full border border-line bg-surface px-4 font-medium"
        >
          {dark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
          <span className="hidden sm:inline">{dark ? "Gaišs" : "Tumšs"}</span>
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex h-12 items-center gap-2 rounded-full bg-pine px-5 font-medium text-surface disabled:opacity-60"
        >
          <RefreshCw className={loading ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} />
          <span>{loading ? "Atjauno" : "Atjaunot"}</span>
        </button>
      </div>
      {live ? <LiveDock dossier={dossier} tournament={live} /> : null}
    </header>
  );
}

function Overview({ dossier, alerts }: { dossier: Dossier; alerts: AlertState }) {
  const { totals, player } = dossier;
  const stats = [
    { label: "Turnīri", value: String(totals.tournaments) },
    { label: "Partijas", value: String(totals.games) },
    { label: "Punkti", value: formatPoints(totals.score) },
    { label: "Bilance", value: `${totals.wins}–${totals.draws}–${totals.losses}` },
  ];
  return (
    <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="overflow-hidden rounded-3xl border border-line bg-white">
        <div className="flex items-center gap-4 bg-pine px-5 py-4 text-white">
          <Knight tone="white" className="size-16 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium tracking-wide uppercase">Personīgais asistents</p>
            <h1 className="text-4xl text-white sm:text-5xl">{DISPLAY_NAME}</h1>
          </div>
        </div>
        <div className="p-5 sm:p-6">
          <p className="text-muted">
            FIDE {player.fideId}
            {player.birthYear ? ` · dz. ${player.birthYear}` : ""}
            {player.club ? ` · ${player.club}` : ""}
          </p>
          {totals.bestRank ? (
            <p className="mt-3 max-w-xl text-pretty text-lg">Labākā vieta — {totals.bestRank}.</p>
          ) : null}
          <button
            type="button"
            onClick={() => void alerts.toggle()}
            aria-pressed={alerts.enabled}
            className={
              "mt-5 inline-flex h-12 items-center gap-2 rounded-full px-5 font-medium " +
              (alerts.enabled ? "border border-pine bg-white text-pine" : "bg-pine text-white")
            }
          >
            {alerts.enabled ? <BellOff className="size-4" aria-hidden /> : <Bell className="size-4" aria-hidden />}
            {alerts.enabled ? "Paziņojumi ieslēgti" : "Paziņot telefonā"}
          </button>
          <p className="mt-2 max-w-md text-sm text-muted">
            {alerts.note ||
              "Ieslēdz, un telefons paziņos un iezvanīs, kad chess-results publicēs nākamo galdiņu. Lapa jātur atvērta."}
          </p>
          <CopySummary dossier={dossier} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-line bg-white px-4 py-4">
            <p className="text-sm text-muted">{stat.label}</p>
            <p className="mt-1 font-display text-3xl text-pine tabular-nums">{stat.value}</p>
          </div>
        ))}
      </div>
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

function Board({
  dossier,
  notes,
}: {
  dossier: Dossier;
  notes: { notes: Record<string, string>; save: (id: string, text: string) => void };
}) {
  const [query, setQuery] = useState("");
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
  const active = repeats.find((opponent) => opponent.key === selected) ?? opponents.find((opponent) => opponent.key === selected) ?? null;

  return (
    <div className="mt-8 grid gap-8">
      <div className="grid gap-3">
        <label className="flex h-14 items-center gap-3 rounded-full border border-line bg-white px-4">
          <Search className="size-5 text-muted" aria-hidden />
          <input
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
          <FilterChip pressed={pace === "other"} onClick={() => setPace("other")}>
            Citi
          </FilterChip>
        </div>
        {needle ? (
          <p className="px-4 text-sm text-muted">
            {tournaments.length === 1 ? "1 turnīrs" : `${tournaments.length} turnīri`} ·{" "}
            {opponents.length === 1 ? "1 pretinieks" : `${opponents.length} pretinieki`}
          </p>
        ) : null}
      </div>

      <section>
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
                notes={notes}
              />
            ))}
          </div>
        )}
      </section>

      {repeats.length > 0 ? (
        <section>
          <SectionTitle title="Atkārtoti pretinieki" hint="spēlēts vairāk nekā vienu reizi" />
          <ul className="grid gap-2">
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

      <section>
        <SectionTitle title="Pretinieki" hint={needle ? `${opponents.length} atbilst` : "cik reižu un kā veicies"} />
        {opponents.length === 0 ? (
          <Empty>{needle ? "Nav pretinieku, kas atbilst meklējumam." : "Vēl nav pretinieku šajos turnīros."}</Empty>
        ) : (
          <ul className="grid gap-2">
            {opponents.map((opponent) => (
              <li key={opponent.key}>
                <OpponentRow
                  opponent={opponent}
                  pressed={opponent.key === selected}
                  onSelect={() => setSelected((current) => (current === opponent.key ? null : opponent.key))}
                />
              </li>
            ))}
          </ul>
        )}
        {active ? <Meetings opponent={active} /> : null}
      </section>
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
  notes,
}: {
  tournament: Tournament;
  today: string;
  startOpen: boolean;
  games: Game[];
  notes: { notes: Record<string, string>; save: (id: string, text: string) => void };
}) {
  const status = dayStatus(tournament.endDate, today);
  const badge = status === "today" ? "Šodien" : status === "upcoming" ? "Gaidāms" : null;
  const medal = tournament.rank != null && tournament.rank >= 1 && tournament.rank <= 3;
  const [opened, setOpened] = useState(startOpen);
  useEffect(() => {
    setOpened(startOpen);
  }, [startOpen]);
  return (
    <article className={`min-w-0 rounded-2xl border-2 bg-surface ${scoreBorder(tournament)}`}>
      <details className="group" open={opened} onToggle={(event) => setOpened(event.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {badge ? (
                <span className="rounded-full bg-pine px-2 py-0.5 text-xs font-medium text-surface">{badge}</span>
              ) : null}
              {medal ? (
                <span className="rounded-full bg-pine-soft px-2 py-0.5 text-xs font-medium text-pine">
                  {tournament.rank}. vieta
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
              <GameTable games={games} notes={notes} />
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

function GameTable({
  games,
  notes,
}: {
  games: Game[];
  notes: { notes: Record<string, string>; save: (id: string, text: string) => void };
}) {
  if (games.length === 0) return <p className="text-sm text-muted">Partijas vēl nav publicētas.</p>;
  return (
    <ol className="grid gap-2">
      {games.map((game) => {
        const id = noteId(game);
        return (
          <li key={id} className="rounded-xl bg-bg px-3 py-3">
            <div className="grid grid-cols-[2.5rem_2.75rem_1fr_auto] items-center gap-3">
              <span className="text-sm text-muted tabular-nums">{game.round}.</span>
              <PieceMark color={game.color} />
              <span className="min-w-0">
                <span className="block truncate font-medium">{game.opponent}</span>
                <span className="block truncate text-sm text-muted">
                  {colorName(game.color).toLocaleLowerCase("lv")}
                  {game.board > 0 ? ` · ${game.board}. galds` : ""}
                  {game.opponentClub ? ` · ${game.opponentClub}` : ""}
                </span>
              </span>
              <ResultMark result={game.result} />
            </div>
            <GameNote id={id} value={notes.notes[id] ?? ""} onSave={notes.save} />
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
        <span className="block truncate text-sm text-muted">{opponent.club || opponent.fed}</span>
      </span>
      <span className="text-right">
        <span className="block font-medium tabular-nums">
          {opponent.wins}–{opponent.draws}–{opponent.losses}
        </span>
        <span className="block text-sm text-muted tabular-nums">{formatPoints(opponent.score)} · {percent}%</span>
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
  return dossier.tournaments.filter((tournament) => dayStatus(tournament.endDate, dossier.today) === "today" || tournament.nextGame || tournament.awaitingPairing);
}

function NextGames({ dossier }: { dossier: Dossier }) {
  const cards = liveTournaments(dossier).filter((tournament) => tournament.nextGame || tournament.awaitingPairing || dayStatus(tournament.endDate, dossier.today) === "today");
  if (cards.length === 0) return null;
  return (
    <div className="mt-6 grid gap-3">
      {cards.map((tournament) =>
        tournament.nextGame ? (
          <NextGameBanner key={tournament.id} tournament={tournament} />
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

function NextGameBanner({ tournament }: { tournament: Tournament }) {
  const next = tournament.nextGame;
  if (!next) return null;
  return (
    <section className="overflow-hidden rounded-3xl bg-pine text-white">
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
          <p className="mt-4 text-lg">pret {next.opponent}</p>
          <p className="mt-1 text-sm text-pine-soft">
            {placeLine(tournament)}
            {next.publishedAt ? ` · izloze publicēta ${next.publishedAt}` : tournament.lastRoundAt ? ` · iepriekšējā kārta publicēta ${tournament.lastRoundAt}` : ""}
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

function RoundNote({ tournament }: { tournament: Tournament }) {
  const next = tournament.nextGame;
  if (next) {
    return (
      <p className="mb-3 text-sm">
        Nākamā: {next.round}. kārta, {next.board > 0 ? `${next.board}. galds` : "galds vēl nav zināms"}, {colorName(next.color).toLocaleLowerCase("lv")} pret {next.opponent}.
        {next.publishedAt ? ` Izloze publicēta ${next.publishedAt}.` : tournament.lastRoundAt ? ` Iepriekšējā kārta publicēta ${tournament.lastRoundAt}.` : ""}
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
    <section className="mt-8">
      <SectionTitle title="Grafiki" hint="šodiena, bilance un krāsas" />
      <div className="grid gap-3 lg:grid-cols-2">
        {today && today.games.length > 0 ? <RoundBars tournament={today} /> : null}
        <BalanceBar dossier={dossier} />
        <ColorSplit title="Krāsas" hint="visas partijas" games={games} />
        <ColorSplit title="Krāsas uzvarās" hint="tikai uzvarētās partijas" games={games.filter((game) => game.result === "win")} />
        {today && today.games.length > 0 ? <TodayColors games={today.games} /> : null}
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

function GameNote({ id, value, onSave }: { id: string; value: string; onSave: (id: string, text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (!editing) {
    return (
      <div className="mt-2">
        {value ? <p className="text-sm">{value}</p> : null}
        <button type="button" onClick={() => setEditing(true)} className="h-11 text-sm font-medium text-pine">
          {value ? "Labot piezīmi" : "Piezīme"}
        </button>
      </div>
    );
  }
  return (
    <textarea
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        onSave(id, draft);
        setEditing(false);
      }}
      rows={2}
      autoFocus
      placeholder="Piezīme paliek tikai šajā telefonā"
      className="mt-2 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none"
    />
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
    lines.push(
      `Nākamā: ${next.round}. kārta, ${next.board > 0 ? `${next.board}. galds, ` : ""}${colorName(next.color).toLocaleLowerCase("lv")} pret ${next.opponent}.`,
    );
    if (next.publishedAt) lines.push(`Izloze publicēta ${next.publishedAt}.`);
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
            {next.publishedAt ? ` · izloze ${next.publishedAt}` : tournament.lastRoundAt ? ` · iepriekšējā ${tournament.lastRoundAt}` : ""}
          </p>
        </div>
        <CopySummary dossier={dossier} compact />
      </div>
    </div>
  );
}

function InstallHint() {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (localStorage.getItem("valters-install") === "1" || standalone) setOpen(false);
  }, []);
  if (!open) return null;
  return (
    <section className="mb-4 rounded-2xl border border-line bg-surface px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-xl">Uz sākuma ekrāna</h2>
        <button
          type="button"
          className="h-12 shrink-0 rounded-full px-3 text-sm font-medium text-pine"
          onClick={() => {
            localStorage.setItem("valters-install", "1");
            setOpen(false);
          }}
        >
          Aizvērt
        </button>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        iPhone: Safari dalīšanās poga, tad «Pievienot sākuma ekrānam». Android: pārlūka izvēlne, tad «Pievienot sākuma ekrānam». Lapa atveras vienā pieskārienā. Signāls par jaunu galdiņu skan, kamēr lapa ir atvērta.
      </p>
    </section>
  );
}

function streakStats(games: Game[]) {
  let run = 0;
  let best = 0;
  for (const game of games) {
    if (game.result === "win") {
      run += 1;
      best = Math.max(best, run);
    } else if (game.score != null) {
      run = 0;
    }
  }
  let current = 0;
  for (let index = games.length - 1; index >= 0; index -= 1) {
    if (games[index]?.result !== "win") break;
    current += 1;
  }
  return { current, best, last: games.slice(-10) };
}

function Records({ dossier }: { dossier: Dossier }) {
  const games = timeline(dossier);
  const { current, best, last } = streakStats(games);
  const bestPoints = dossier.tournaments.reduce<Tournament | null>((chosen, tournament) => {
    if (tournament.points == null) return chosen;
    if (!chosen || (chosen.points ?? 0) < tournament.points) return tournament;
    return chosen;
  }, null);
  const bestPerformance = dossier.tournaments.reduce<Tournament | null>((chosen, tournament) => {
    if (tournament.performance == null) return chosen;
    if (!chosen || (chosen.performance ?? 0) < tournament.performance) return tournament;
    return chosen;
  }, null);
  const cards = [
    { label: "Pašreizējā sērija", value: String(current) },
    { label: "Garākā sērija", value: String(best) },
    { label: "Labākā vieta", value: dossier.totals.bestRank ? String(dossier.totals.bestRank) : "—" },
    { label: "Vairāk punktu", value: bestPoints ? formatPoints(bestPoints.points) : "—" },
    { label: "Labākais performance", value: bestPerformance?.performance ? String(bestPerformance.performance) : "—" },
  ];
  return (
    <section className="mt-8">
      <SectionTitle title="Rekordi" hint="sērijas un labākie turnīri" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {cards.map((card) => (
          <div key={card.label} className="rounded-2xl border border-line bg-surface px-4 py-4">
            <p className="text-sm text-muted">{card.label}</p>
            <p className="mt-1 font-display text-3xl text-pine tabular-nums">{card.value}</p>
          </div>
        ))}
      </div>
      {last.length > 0 ? (
        <div className="mt-3 rounded-2xl border border-line bg-surface px-4 py-4">
          <p className="text-sm text-muted">Pēdējās {last.length} partijas</p>
          <ol className="mt-3 flex gap-2 overflow-x-auto">
            {last.map((game) => (
              <li key={`${game.tournamentId}-${game.round}-${game.opponent}`}>
                <ResultMark result={game.result} />
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

function TodayColors({ games }: { games: Game[] }) {
  const rows = (["white", "black"] as const).map((color) => {
    const mine = games.filter((game) => game.color === color);
    const scored = mine.filter((game) => game.score != null);
    return {
      color,
      count: mine.length,
      score: scored.reduce((sum, game) => sum + (game.score ?? 0), 0),
    };
  });
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="text-xl">Šodienas krāsas</h3>
      <ul className="mt-3 grid gap-3 text-sm">
        {rows.map((row) => (
          <li key={row.color} className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2">
              <MiniBoard color={row.color} className="size-10" />
              {colorName(row.color)}
            </span>
            <span className="tabular-nums">
              {row.count} partijas · {formatPoints(row.score)} punkti
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
