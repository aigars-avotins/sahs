export type GameResult = "win" | "draw" | "loss" | "unknown";
export type PieceColor = "white" | "black" | "unknown";
export type DayStatus = "today" | "upcoming" | "past" | "unknown";

export type Game = {
  round: number;
  board: number;
  opponent: string;
  opponentTitle: string;
  opponentRating: number | null;
  opponentFed: string;
  opponentClub: string;
  opponentPoints: number | null;
  result: GameResult;
  resultRaw: string;
  score: number | null;
  color: PieceColor;
  tournamentId: string;
  tournamentName: string;
  tournamentDate: string;
  location: string;
};

export type Tournament = {
  id: string;
  name: string;
  url: string;
  playerUrl: string;
  endDate: string;
  rank: number | null;
  rounds: number | null;
  fieldSize: number | null;
  club: string;
  fed: string;
  points: number | null;
  performance: number | null;
  startingRank: number | null;
  birthYear: string;
  location: string;
  timeControl: string;
  organizer: string;
  lastUpdate: string;
  roundsScheduled: number | null;
  partial: boolean;
  games: Game[];
};

export type Opponent = {
  key: string;
  name: string;
  club: string;
  fed: string;
  games: number;
  scored: number;
  wins: number;
  draws: number;
  losses: number;
  score: number;
  lastDate: string;
  lastTournament: string;
  lastLocation: string;
  lastResult: GameResult;
  meetings: Game[];
};

export type Dossier = {
  player: {
    name: string;
    fideId: string;
    birthYear: string;
    club: string;
    fed: string;
  };
  fetchedAt: string;
  today: string;
  tournaments: Tournament[];
  opponents: Opponent[];
  totals: {
    tournaments: number;
    games: number;
    scored: number;
    wins: number;
    draws: number;
    losses: number;
    score: number;
    bestRank: number | null;
  };
  partialNote: string | null;
};

export type LoadResult =
  | { ok: true; dossier: Dossier; stale: boolean; warning: string | null }
  | { ok: false; error: string };
