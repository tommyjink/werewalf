import "dotenv/config";
import { createServer } from "http";
import next from "next";
import { Server } from "socket.io";
import { registerSocketHandlers } from "./src/server/socket";
import type { ClientToServerEvents, ServerToClientEvents } from "./src/types/shared";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = Number(process.env.PORT || 8105);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    handle(req, res);
  });

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: "*"
    }
  });
  registerSocketHandlers(io);

  httpServer.listen(port, hostname, () => {
    console.log(`Werewolf room server ready on http://${hostname}:${port}`);
  });
});
