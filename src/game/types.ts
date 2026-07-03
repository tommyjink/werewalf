import type { AiModel, ChatMessage, GamePhase, Role, Winner } from "../types/shared";

export type Seat = {
  index: number;
  kind: "empty" | "human" | "ai";
  playerId: string | null;
  token: string | null;
  name: string | null;
  connected: boolean;
  role: Role | null;
  alive: boolean;
  model: AiModel;
  personality: string;
};

export type SeerCheck = {
  day: number;
  targetId: string;
  targetName: string;
  role: Role;
};

export type GameState = {
  phase: GamePhase;
  day: number;
  phaseEndsAt: number | null;
  speechOrder: string[];
  currentSpeakerIndex: number;
  wolfVotes: Record<string, string>;
  seerTarget: string | null;
  votes: Record<string, string>;
  voteRound: 1 | 2;
  tieCandidateIds: string[];
  seerChecks: Record<string, SeerCheck[]>;
  wolfMessages: ChatMessage[];
  winner: Winner | null;
  resultReason: string | null;
};

export type Room = {
  id: string;
  hostToken: string;
  seats: Seat[];
  messages: ChatMessage[];
  game: GameState;
  timer: NodeJS.Timeout | null;
  ticker: NodeJS.Timeout | null;
  aiTasks: Set<string>;
};

export type PlayerSeat = Seat & {
  kind: "human" | "ai";
  playerId: string;
  name: string;
};
