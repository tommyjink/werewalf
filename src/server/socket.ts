import type { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "../types/shared";
import { GameManager } from "../game/manager";

export function registerSocketHandlers(io: Server<ClientToServerEvents, ServerToClientEvents>) {
  const manager = new GameManager(io);
  io.on("connection", (socket) => manager.register(socket));
}
