import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell,
  BellOff,
  ExternalLink,
  MapPin,
  RefreshCw,
  Search,
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
    if (dossier) rememberPairings(pairingKeys(dossier));
    setEnabled(true);
    setNote("Ieslēgts. Kamēr lapa ir atvērta, telefons paziņos par jaunu galdiņu.");
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
        <Overview dossier={result.dossier} alerts={alerts} />
        <NextGames dossier={result.dossier} />
        <Charts dossier={result.dossier} />
        <Board dossier={result.dossier} />
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
    <div className="min-h-screen bg-bg text-ink">
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
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-white/95">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
        <Knight tone="white" className="size-10 shrink-0 rounded-lg bg-pine p-0.5" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{DISPLAY_NAME}</p>
          <p className="truncate text-sm text-muted">
            Atjaunots {formatStamp(dossier.fetchedAt)}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-pine px-4 font-medium text-surface disabled:opacity-60"
        >
          <RefreshCw className={loading ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} />
          <span>{loading ? "Atjauno" : "Atjaunot"}</span>
        </button>
      </div>
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
          <p className="mt-3 max-w-xl text-pretty text-lg">
            Ar ko spēlēts, cik reižu, kā veicies un kur.
            {totals.bestRank ? ` Labākā vieta — ${totals.bestRank}.` : ""}
          </p>
          <button
            type="button"
            onClick={() => void alerts.toggle()}
            aria-pressed={alerts.enabled}
            className={
              "mt-5 inline-flex h-11 items-center gap-2 rounded-full px-4 font-medium " +
              (alerts.enabled ? "border border-pine bg-white text-pine" : "bg-pine text-white")
            }
          >
            {alerts.enabled ? <BellOff className="size-4" aria-hidden /> : <Bell className="size-4" aria-hidden />}
            {alerts.enabled ? "Paziņojumi ieslēgti" : "Paziņot telefonā"}
          </button>
          <p className="mt-2 max-w-md text-sm text-muted">
            {alerts.note ||
              "Ieslēdz, un telefons paziņos, kad chess-results publicēs nākamo galdiņu. Lapa jātur atvērta."}
          </p>
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

function Board({ dossier }: { dossier: Dossier }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const needle = query.trim().toLocaleLowerCase("lv");

  const tournaments = useMemo(() => {
    if (!needle) return dossier.tournaments;
    return dossier.tournaments.filter((tournament) =>
      [tournament.name, tournament.location, tournament.organizer, ...tournament.games.map((game) => game.opponent)]
        .join(" ")
        .toLocaleLowerCase("lv")
        .includes(needle),
    );
  }, [dossier.tournaments, needle]);

  const opponents = useMemo(() => {
    if (!needle) return dossier.opponents;
    return dossier.opponents.filter((opponent) =>
      `${opponent.name} ${opponent.club} ${opponent.lastTournament} ${opponent.lastLocation}`
        .toLocaleLowerCase("lv")
        .includes(needle),
    );
  }, [dossier.opponents, needle]);

  const active = opponents.find((opponent) => opponent.key === selected) ?? null;

  return (
    <div className="mt-8 grid gap-8">
      <label className="flex h-12 items-center gap-3 rounded-full border border-line bg-surface px-4">
        <Search className="size-4 text-muted" aria-hidden />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Meklēt pretinieku, klubu vai turnīru"
          className="w-full bg-transparent text-base outline-none placeholder:text-muted"
        />
      </label>

      <section>
        <SectionTitle title="Turnīri" hint={`${tournaments.length} no ${dossier.tournaments.length}`} />
        {tournaments.length === 0 ? (
          <Empty>Nav turnīru, kas atbilst meklējumam.</Empty>
        ) : (
          <div className="grid gap-3">
            {tournaments.map((tournament, index) => (
              <TournamentCard
                key={tournament.id}
                tournament={tournament}
                today={dossier.today}
                startOpen={index === 0 && !needle}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle title="Pretinieki" hint="cik reižu un kā veicies" />
        {opponents.length === 0 ? (
          <Empty>Vēl nav pretinieku šajos turnīros.</Empty>
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
}: {
  tournament: Tournament;
  today: string;
  startOpen: boolean;
}) {
  const status = dayStatus(tournament.endDate, today);
  const badge = status === "today" ? "Šodien" : status === "upcoming" ? "Gaidāms" : null;
  const [opened, setOpened] = useState(startOpen);
  useEffect(() => {
    if (startOpen) setOpened(true);
  }, [startOpen]);
  return (
    <article className="min-w-0 rounded-2xl border border-line bg-surface">
      <details
        className="group"
        open={opened}
        onToggle={(event) => setOpened(event.currentTarget.open)}
      >
        <summary className="flex cursor-pointer list-none flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {badge ? (
                <span className="rounded-full bg-pine px-2 py-0.5 text-xs font-medium text-surface">{badge}</span>
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
          {tournament.partial ? (
            <p className="text-sm text-brass">Partiju sarakstu šoreiz neizdevās nolasīt.</p>
          ) : (
            <>
              <RoundNote tournament={tournament} />
              <GameTable games={tournament.games} />
            </>
          )}
          <a
            href={tournament.playerUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex h-11 items-center gap-2 text-sm font-medium text-pine"
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
          className="grid grid-cols-[2.5rem_2.75rem_1fr_auto] items-center gap-3 rounded-xl bg-bg px-3 py-2"
        >
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
  const percent = opponent.scored ? Math.round((opponent.score / opponent.scored) * 100) : 0;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onSelect}
      className={
        "flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left motion-reduce:transition-none " +
        (pressed ? "border-pine bg-pine-soft" : "border-line bg-surface")
      }
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-bg-deep font-display text-lg tabular-nums">
        {opponent.games}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{opponent.name}</span>
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
          <Knight tone={next.color === "black" ? "black" : "white"} className="size-28" />
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
            {next.opponentPoints != null ? `${formatPoints(next.opponentPoints)} punkti pirms partijas` : null}
            {next.opponentPoints != null && tournament.location ? " · " : ""}
            {tournament.location || tournament.name}
          </p>
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
        </p>
      ) : null}
    </section>
  );
}

function RoundNote({ tournament }: { tournament: Tournament }) {
  const next = tournament.nextGame;
  if (next) {
    return (
      <p className="mb-3 text-sm">
        Nākamā: {next.round}. kārta, {next.board > 0 ? `${next.board}. galds` : "galds vēl nav zināms"}, {colorName(next.color).toLocaleLowerCase("lv")} pret {next.opponent}.
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
      <div className="grid gap-3 lg:grid-cols-3">
        {today && today.games.length > 0 ? <RoundBars tournament={today} /> : null}
        <BalanceBar dossier={dossier} />
        <ColorBars games={games} />
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

function ColorBars({ games }: { games: Game[] }) {
  const rows = (["white", "black"] as const).map((color) => {
    const played = games.filter((game) => game.color === color && game.score != null);
    const score = played.reduce((sum, game) => sum + (game.score ?? 0), 0);
    const percent = played.length ? Math.round((score / played.length) * 100) : 0;
    return { color, played: played.length, score, percent };
  });
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="text-xl">Krāsas</h3>
      <ul className="mt-3 grid gap-3">
        {rows.map((row) => (
          <li key={row.color}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="inline-flex items-center gap-2">
                <Knight tone={row.color} className="size-5" />
                {colorName(row.color)}
              </span>
              <span className="tabular-nums text-muted">
                {formatPoints(row.score)}/{row.played} · {row.percent}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-bg-deep">
              <div className={row.color === "white" ? "h-full bg-pine-soft" : "h-full bg-pine"} style={{ width: `${row.percent}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
