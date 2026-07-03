"use client";

import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@/types/shared";

const HUMAN_NAMES = [
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

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function getSocket() {
  if (!socket) {
    socket = io({
      transports: ["websocket", "polling"],
      autoConnect: true
    });
  }
  return socket;
}

export function getOrCreateToken() {
  const key = "werewolf_token";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const token = `tok_${createBrowserId()}`;
  window.localStorage.setItem(key, token);
  return token;
}

export function getSavedName() {
  const saved = window.localStorage.getItem("werewolf_name");
  if (saved) return saved;
  const pick = randomHumanName();
  window.localStorage.setItem("werewolf_name", pick);
  return pick;
}

export function saveName(name: string) {
  const trimmed = name.trim();
  const next = trimmed || randomHumanName();
  window.localStorage.setItem("werewolf_name", next);
  return next;
}

function randomHumanName() {
  return HUMAN_NAMES[Math.floor(Math.random() * HUMAN_NAMES.length)];
}

function createBrowserId() {
  const randomCrypto = window.crypto?.getRandomValues?.bind(window.crypto);
  if (randomCrypto) {
    const bytes = new Uint8Array(16);
    randomCrypto(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}
