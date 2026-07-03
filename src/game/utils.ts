import { randomBytes } from "crypto";
import { ABSTAIN_ID, MAX_SEATS } from "../types/shared";
import type { PlayerSeat, Room, Seat } from "./types";

const AI_NAMES = [
  "James",
  "Emily",
  "Daniel",
  "Olivia",
  "Michael",
  "Sophia",
  "William",
  "Grace",
  "Henry",
  "Emma",
  "David",
  "Lily",
  "Thomas",
  "Ava",
  "Jack",
  "Mia",
  "Lucas",
  "Chloe",
  "Mason",
  "Ella"
];

let aiNameIndex = 0;

export function randomAiName(): string {
  const name = AI_NAMES[aiNameIndex % AI_NAMES.length];
  aiNameIndex += 1;
  return name;
}

export const HUMAN_DEFAULTS = [
  "James",
  "Emily",
  "Daniel",
  "Olivia",
  "Michael",
  "Sophia",
  "William",
  "Grace",
  "Henry",
  "Emma",
  "David",
  "Lily",
  "Thomas",
  "Ava",
  "Jack",
  "Mia",
  "Lucas",
  "Chloe",
  "Mason",
  "Ella"
];

export function randomHumanName(): string {
  return HUMAN_DEFAULTS[Math.floor(Math.random() * HUMAN_DEFAULTS.length)];
}

export function createId(prefix = "") {
  return `${prefix}${randomBytes(6).toString("hex")}`;
}

export function createRoomId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let index = 0; index < 5; index += 1) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}

export function createEmptySeats(): Seat[] {
  return Array.from({ length: MAX_SEATS }, (_, index) => ({
    index,
    kind: "empty",
    playerId: null,
    token: null,
    name: null,
    connected: false,
    role: null,
    alive: false,
    model: "deepseek-v4-flash",
    personality: ""
  }));
}

export function playerSeats(room: Room): PlayerSeat[] {
  return room.seats.filter((seat): seat is PlayerSeat => {
    return seat.kind !== "empty" && Boolean(seat.playerId && seat.name);
  });
}

export function alivePlayers(room: Room): PlayerSeat[] {
  return playerSeats(room).filter((seat) => seat.alive);
}

export function getSeatByToken(room: Room, token: string) {
  return room.seats.find((seat) => seat.kind === "human" && seat.token === token) ?? null;
}

export function getSeatByPlayerId(room: Room, playerId: string | null) {
  if (!playerId) {
    return null;
  }
  return room.seats.find((seat) => seat.playerId === playerId) ?? null;
}

export function isHost(room: Room, token: string) {
  return room.hostToken === token;
}

export function pickRandom<T>(items: T[]): T | null {
  if (items.length === 0) {
    return null;
  }
  return items[Math.floor(Math.random() * items.length)];
}

export function majorityTarget(votes: Record<string, string>) {
  const counts = new Map<string, number>();
  for (const target of Object.values(votes)) {
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  if (counts.size === 0) {
    return null;
  }

  let highScore = 0;
  let tied: string[] = [];
  for (const [target, count] of counts) {
    if (count > highScore) {
      highScore = count;
      tied = [target];
    } else if (count === highScore) {
      tied.push(target);
    }
  }
  return pickRandom(tied);
}

export function uniqueTopTarget(votes: Record<string, string>) {
  const counts = new Map<string, number>();
  for (const target of Object.values(votes)) {
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  if (counts.size === 0) {
    return null;
  }

  let highScore = 0;
  let winner: string | null = null;
  let tied = false;
  for (const [target, count] of counts) {
    if (count > highScore) {
      highScore = count;
      winner = target;
      tied = false;
    } else if (count === highScore) {
      tied = true;
    }
  }
  return tied ? null : winner;
}

export type VoteResolution = {
  winner: string | null;
  tiedPlayers: string[];
  highScore: number;
  topChoices: string[];
};

export function resolvePublicVote(votes: Record<string, string>): VoteResolution {
  const counts = new Map<string, number>();
  for (const target of Object.values(votes)) {
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }

  if (counts.size === 0) {
    return { winner: null, tiedPlayers: [], highScore: 0, topChoices: [] };
  }

  let highScore = 0;
  for (const count of counts.values()) {
    if (count > highScore) highScore = count;
  }

  const topChoices = [...counts.entries()]
    .filter(([, count]) => count === highScore)
    .map(([target]) => target);
  const tiedPlayers = topChoices.filter((target) => target !== ABSTAIN_ID);
  const winner = topChoices.length === 1 && topChoices[0] !== ABSTAIN_ID ? topChoices[0] : null;

  return { winner, tiedPlayers, highScore, topChoices };
}
