export const MAX_SEATS = 8;
export const MIN_PLAYERS = 6;
export const ABSTAIN_ID = "__abstain__";

export const AI_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"] as const;

export type AiModel = (typeof AI_MODELS)[number];
export type SeatKind = "empty" | "human" | "ai";
export type Role = "werewolf" | "seer" | "villager";
export type GamePhase =
  | "lobby"
  | "night_wolves"
  | "night_seer"
  | "day_speech"
  | "tie_speech"
  | "day_vote"
  | "result";
export type Winner = "wolves" | "villagers";

export type PublicSeat = {
  index: number;
  playerId: string | null;
  kind: SeatKind;
  name: string | null;
  connected: boolean;
  alive: boolean;
  isHost: boolean;
  model?: AiModel;
  personality?: string;
  revealedRole?: Role;
};

export type ChatMessage = {
  id: string;
  type: "system" | "speech" | "action" | "wolf";
  author: string;
  seatIndex?: number;
  playerId?: string;
  text: string;
  createdAt: number;
};

export type RoomState = {
  id: string;
  hostSeatIndex: number | null;
  phase: GamePhase;
  day: number;
  seats: PublicSeat[];
  messages: ChatMessage[];
  phaseEndsAt: number | null;
  currentSpeakerId: string | null;
  voteSummary: Record<string, number>;
  voteRound: 1 | 2;
  tieCandidateIds: string[];
  winner: Winner | null;
  resultReason: string | null;
};

export type PrivateState = {
  roomId: string;
  token: string;
  seatIndex: number | null;
  playerId: string | null;
  role: Role | null;
  alive: boolean;
  isHost: boolean;
  knownWolves: Array<{ playerId: string; name: string; seatIndex: number }>;
  seerChecks: Array<{ day: number; targetName: string; role: Role }>;
  canSpeak: boolean;
  canVote: boolean;
  canWolfChat: boolean;
  canNightAct: boolean;
  votedFor: string | null;
  nightTarget: string | null;
  wolfMessages: ChatMessage[];
};

export type ServerToClientEvents = {
  room_state: (state: RoomState) => void;
  private_state: (state: PrivateState) => void;
  chat_message: (message: ChatMessage) => void;
  phase_changed: (state: RoomState) => void;
  timer_tick: (payload: { roomId: string; phaseEndsAt: number | null; now: number }) => void;
  action_result: (payload: { ok: boolean; message: string }) => void;
  game_over: (state: RoomState) => void;
  error_message: (payload: { message: string }) => void;
};

export type ClientToServerEvents = {
  create_room: (
    payload: { token: string; name: string },
    ack?: (response: SocketAck<{ roomId: string; token: string }>) => void
  ) => void;
  join_room: (
    payload: { roomId: string; token: string; name: string },
    ack?: (response: SocketAck<{ roomId: string; token: string }>) => void
  ) => void;
  claim_seat: (payload: { roomId: string; token: string; seatIndex: number; name: string }) => void;
  set_seat: (payload: { roomId: string; token: string; seatIndex: number; kind: SeatKind }) => void;
  configure_ai: (
    payload: { roomId: string; token: string; seatIndex: number; model: AiModel; personality: string }
  ) => void;
  start_game: (payload: { roomId: string; token: string }) => void;
  send_message: (payload: { roomId: string; token: string; text: string }) => void;
  wolf_message: (payload: { roomId: string; token: string; text: string }) => void;
  night_action: (payload: { roomId: string; token: string; targetPlayerId: string }) => void;
  vote: (payload: { roomId: string; token: string; targetPlayerId: string }) => void;
  advance_speech: (payload: { roomId: string; token: string }) => void;
};

export type SocketAck<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: string;
    };
