import type { Server, Socket } from "socket.io";
import type {
  AiModel,
  ChatMessage,
  ClientToServerEvents,
  GamePhase,
  PrivateState,
  PublicSeat,
  Role,
  RoomState,
  ServerToClientEvents,
  SocketAck
} from "../types/shared";
import { ABSTAIN_ID, AI_MODELS, MIN_PLAYERS } from "../types/shared";
import { aiChooseTarget, aiSpeak, aiWolfTalk, describeTarget } from "./ai";
import type { GameState, PlayerSeat, Room, Seat } from "./types";
import {
  alivePlayers,
  createEmptySeats,
  createId,
  createRoomId,
  getSeatByPlayerId,
  getSeatByToken,
  isHost,
  majorityTarget,
  pickRandom,
  playerSeats,
  randomAiName,
  randomHumanName,
  resolvePublicVote
} from "./utils";

type IOServer = Server<ClientToServerEvents, ServerToClientEvents>;
type IOSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type Connection = { roomId: string; token: string };
type TimedPhase = Exclude<GamePhase, "lobby" | "result">;

const PHASE_SECONDS: Record<TimedPhase, number> = {
  night_wolves: 45,
  night_seer: 30,
  day_speech: 45,
  tie_speech: 45,
  day_vote: 45
};

function createGameState(): GameState {
  return {
    phase: "lobby",
    day: 0,
    phaseEndsAt: null,
    speechOrder: [],
    currentSpeakerIndex: 0,
    wolfVotes: {},
    seerTarget: null,
    votes: {},
    voteRound: 1,
    tieCandidateIds: [],
    seerChecks: {},
    wolfMessages: [],
    winner: null,
    resultReason: null
  };
}

function isTimedPhase(phase: GamePhase): phase is TimedPhase {
  return phase !== "lobby" && phase !== "result";
}

export class GameManager {
  private rooms = new Map<string, Room>();
  private connections = new Map<string, Connection>();

  constructor(private io: IOServer) {}

  register(socket: IOSocket) {
    socket.on("create_room", (payload, ack) => this.createRoom(socket, payload, ack));
    socket.on("join_room", (payload, ack) => this.joinRoom(socket, payload, ack));
    socket.on("claim_seat", (payload) => this.withRoom(socket, payload.roomId, (room) => this.claimSeat(room, payload)));
    socket.on("set_seat", (payload) => this.withRoom(socket, payload.roomId, (room) => this.setSeat(room, payload)));
    socket.on("configure_ai", (payload) => this.withRoom(socket, payload.roomId, (room) => this.configureAi(room, payload)));
    socket.on("start_game", (payload) => this.withRoom(socket, payload.roomId, (room) => this.startGame(room, payload.token)));
    socket.on("send_message", (payload) =>
      this.withRoom(socket, payload.roomId, (room) => this.sendHumanMessage(room, payload.token, payload.text))
    );
    socket.on("wolf_message", (payload) =>
      this.withRoom(socket, payload.roomId, (room) => this.sendWolfMessage(room, payload.token, payload.text))
    );
    socket.on("night_action", (payload) =>
      this.withRoom(socket, payload.roomId, (room) => this.submitNightAction(room, payload.token, payload.targetPlayerId))
    );
    socket.on("vote", (payload) =>
      this.withRoom(socket, payload.roomId, (room) => this.submitVote(room, payload.token, payload.targetPlayerId))
    );
    socket.on("advance_speech", (payload) =>
      this.withRoom(socket, payload.roomId, (room) => this.skipSpeech(room, payload.token))
    );
    socket.on("disconnect", () => this.disconnect(socket));
  }

  private createRoom(
    socket: IOSocket,
    payload: { token: string; name: string },
    ack?: (response: SocketAck<{ roomId: string; token: string }>) => void
  ) {
    const token = this.cleanToken(payload.token);
    const name = this.cleanName(payload.name, randomHumanName());
    let roomId = createRoomId();
    while (this.rooms.has(roomId)) roomId = createRoomId();

    const room: Room = {
      id: roomId,
      hostToken: token,
      seats: createEmptySeats(),
      messages: [],
      game: createGameState(),
      timer: null,
      ticker: null,
      aiTasks: new Set()
    };

    room.seats[0] = this.makeHumanSeat(0, token, name);
    this.rooms.set(roomId, room);
    this.attachSocket(socket, room, token);
    this.addMessage(room, "system", "系统", `${name} 创建了房间。`);
    ack?.({ ok: true, data: { roomId, token } });
    this.broadcast(room);
  }

  private joinRoom(
    socket: IOSocket,
    payload: { roomId: string; token: string; name: string },
    ack?: (response: SocketAck<{ roomId: string; token: string }>) => void
  ) {
    const room = this.findRoom(payload.roomId);
    if (!room) {
      ack?.({ ok: false, error: "房间不存在。" });
      return;
    }

    const token = this.cleanToken(payload.token);
    const name = this.cleanName(payload.name, randomHumanName());
    const existing = getSeatByToken(room, token);
    if (existing) {
      existing.connected = true;
      existing.name = name;
      this.attachSocket(socket, room, token);
      ack?.({ ok: true, data: { roomId: room.id, token } });
      this.broadcast(room);
      return;
    }

    if (room.game.phase !== "lobby") {
      ack?.({ ok: false, error: "游戏已经开始，只有原座位玩家可以重连。" });
      return;
    }

    const emptySeat = room.seats.find((seat) => seat.kind === "empty");
    if (!emptySeat) {
      ack?.({ ok: false, error: "房间已满。" });
      return;
    }

    room.seats[emptySeat.index] = this.makeHumanSeat(emptySeat.index, token, name);
    this.attachSocket(socket, room, token);
    this.addMessage(room, "system", "系统", `${name} 加入了房间。`);
    ack?.({ ok: true, data: { roomId: room.id, token } });
    this.broadcast(room);
  }

  private claimSeat(room: Room, payload: { token: string; seatIndex: number; name: string }) {
    if (room.game.phase !== "lobby") return this.action(room, payload.token, false, "游戏开始后不能换座。");
    const current = getSeatByToken(room, payload.token);
    const target = room.seats[payload.seatIndex];
    if (!current || !target) return this.action(room, payload.token, false, "你还没有加入这个房间。");
    if (target.kind !== "empty" && target.token !== payload.token) {
      return this.action(room, payload.token, false, "这个座位已经被占用。");
    }

    const next = this.makeHumanSeat(
      payload.seatIndex,
      payload.token,
      this.cleanName(payload.name, current.name ?? randomHumanName()),
      current.playerId ?? undefined
    );
    room.seats[current.index] = this.makeEmptySeat(current.index);
    room.seats[payload.seatIndex] = next;
    this.broadcast(room);
  }

  private setSeat(room: Room, payload: { token: string; seatIndex: number; kind: "empty" | "human" | "ai" }) {
    if (!this.requireHost(room, payload.token)) return;
    if (room.game.phase !== "lobby") return this.action(room, payload.token, false, "游戏开始后不能调整座位。");
    const seat = room.seats[payload.seatIndex];
    if (!seat) return;

    if (payload.kind === "ai") {
      if (seat.kind === "human") return this.action(room, payload.token, false, "不能覆盖真人座位。");
      room.seats[seat.index] = this.makeAiSeat(seat.index);
    }

    if (payload.kind === "empty") {
      if (seat.kind === "human") return this.action(room, payload.token, false, "不能移除真人座位。");
      room.seats[seat.index] = this.makeEmptySeat(seat.index);
    }

    this.broadcast(room);
  }

  private configureAi(room: Room, payload: { token: string; seatIndex: number; model: AiModel; personality: string }) {
    if (!this.requireHost(room, payload.token)) return;
    if (room.game.phase !== "lobby") return this.action(room, payload.token, false, "游戏开始后不能配置 AI。");
    const seat = room.seats[payload.seatIndex];
    if (!seat || seat.kind !== "ai") return;
    seat.model = AI_MODELS.includes(payload.model) ? payload.model : "deepseek-v4-flash";
    seat.personality = payload.personality.trim().slice(0, 80);
    this.broadcast(room);
  }

  private startGame(room: Room, token: string) {
    if (!this.requireHost(room, token)) return;
    if (room.game.phase !== "lobby") return this.action(room, token, false, "游戏已经开始。");
    const players = playerSeats(room);
    if (players.length < MIN_PLAYERS) return this.action(room, token, false, `至少需要 ${MIN_PLAYERS} 名玩家。`);

    const roles: Role[] = ["werewolf", "werewolf", "seer", ...Array<Role>(players.length - 3).fill("villager")];
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    shuffled.forEach((player, index) => {
      player.role = roles[index];
      player.alive = true;
    });

    room.game = createGameState();
    room.game.day = 1;
    this.addMessage(room, "system", "系统", "身份已发放。第 1 夜开始。");
    this.enterPhase(room, "night_wolves");
  }

  private sendHumanMessage(room: Room, token: string, rawText: string) {
    const seat = getSeatByToken(room, token);
    if (!seat?.playerId || !seat.name) return;
    const text = rawText.trim().slice(0, 300);
    if (!text) return;

    if (room.game.phase === "lobby") {
      this.addMessage(room, "speech", seat.name, text, seat);
      this.broadcast(room);
      return;
    }

    if (!this.canSpeak(room, seat)) return this.action(room, token, false, "现在不是你的发言回合。");
    this.addMessage(room, "speech", seat.name, text, seat);
    this.nextSpeaker(room);
  }

  private sendWolfMessage(room: Room, token: string, rawText: string) {
    const seat = getSeatByToken(room, token);
    if (!seat?.playerId || !seat.name || !seat.alive) return;
    if (room.game.phase !== "night_wolves" || seat.role !== "werewolf") {
      return this.action(room, token, false, "现在不能使用狼队夜聊。");
    }

    const text = rawText.trim().slice(0, 220);
    if (!text) return;
    this.addWolfMessage(room, seat.name, text, seat);
    this.broadcast(room);
  }

  private submitNightAction(room: Room, token: string, targetPlayerId: string) {
    const seat = getSeatByToken(room, token);
    if (!seat?.playerId || !seat.alive || !seat.role) return;
    if (!this.isLegalTarget(room, seat, targetPlayerId)) return this.action(room, token, false, "目标无效。");

    if (room.game.phase === "night_wolves" && seat.role === "werewolf") {
      room.game.wolfVotes[seat.playerId] = targetPlayerId;
      this.action(room, token, true, `已选择 ${describeTarget(room, targetPlayerId)}。`);
      this.broadcast(room);
      if (this.allRoleActorsDone(room, "werewolf", room.game.wolfVotes)) this.resolveWolfPhase(room);
      return;
    }

    if (room.game.phase === "night_seer" && seat.role === "seer") {
      this.resolveSeerPhase(room, seat as PlayerSeat, targetPlayerId);
      return;
    }

    this.action(room, token, false, "当前阶段不能这样行动。");
  }

  private submitVote(room: Room, token: string, targetPlayerId: string) {
    const seat = getSeatByToken(room, token);
    if (!seat?.playerId || !seat.alive) return;
    if (room.game.phase !== "day_vote") return this.action(room, token, false, "现在还不能投票。");
    if (!this.isLegalVoteTarget(room, seat, targetPlayerId)) return this.action(room, token, false, "投票目标无效。");

    room.game.votes[seat.playerId] = targetPlayerId;
    this.action(room, token, true, `已投给 ${describeTarget(room, targetPlayerId)}。`);
    this.broadcast(room);
    if (alivePlayers(room).every((player) => room.game.votes[player.playerId])) {
      this.resolveVotePhase(room);
    } else {
      this.scheduleAi(room);
    }
  }

  private skipSpeech(room: Room, token: string) {
    const current = this.currentSpeaker(room);
    const seat = getSeatByToken(room, token);
    if (!current || !seat?.playerId) return;
    if (seat.playerId !== current.playerId && !isHost(room, token)) {
      return this.action(room, token, false, "只有当前发言者或房主可以跳过。");
    }
    this.addMessage(room, "system", "系统", `${current.name} 跳过发言。`);
    this.nextSpeaker(room);
  }

  private enterPhase(room: Room, phase: GamePhase) {
    this.clearTimers(room);
    room.aiTasks.clear();
    room.game.phase = phase;
    room.game.phaseEndsAt = isTimedPhase(phase) ? Date.now() + PHASE_SECONDS[phase] * 1000 : null;

    if (phase === "day_speech") {
      room.game.voteRound = 1;
      room.game.tieCandidateIds = [];
      room.game.votes = {};
      room.game.speechOrder = alivePlayers(room).map((seat) => seat.playerId);
      room.game.currentSpeakerIndex = 0;
      const current = this.currentSpeaker(room);
      if (current) this.addMessage(room, "system", "系统", `白天开始，轮到 ${current.name} 发言。`);
    }

    if (phase === "tie_speech") {
      room.game.speechOrder = room.game.tieCandidateIds.filter((playerId) => getSeatByPlayerId(room, playerId)?.alive);
      room.game.currentSpeakerIndex = 0;
      const names = room.game.speechOrder
        .map((playerId) => getSeatByPlayerId(room, playerId)?.name)
        .filter(Boolean)
        .join("、");
      const current = this.currentSpeaker(room);
      this.addMessage(room, "system", "系统", `平票玩家 ${names} 进入补充发言。`);
      if (current) this.addMessage(room, "system", "系统", `轮到 ${current.name} 补充发言。`);
    }

    if (phase === "day_vote") {
      room.game.votes = {};
      if (room.game.voteRound === 2) {
        this.addMessage(room, "system", "系统", "开始二次投票，只能投给平票玩家，也可以弃票。再平票则无人出局。");
      } else {
        this.addMessage(room, "system", "系统", "开始投票，可以弃票。若多名玩家最高票平票，将进入补充发言。");
      }
    }

    if (isTimedPhase(phase)) {
      room.timer = setTimeout(() => this.handleTimeout(room.id), PHASE_SECONDS[phase] * 1000);
      room.ticker = setInterval(() => {
        this.io.to(room.id).emit("timer_tick", { roomId: room.id, phaseEndsAt: room.game.phaseEndsAt, now: Date.now() });
      }, 1000);
    }

    this.io.to(room.id).emit("phase_changed", this.publicState(room));
    this.broadcast(room);
    this.scheduleAi(room);
  }

  private handleTimeout(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    if (room.game.phase === "night_wolves") {
      for (const wolf of this.aliveRole(room, "werewolf")) {
        if (room.game.wolfVotes[wolf.playerId]) continue;
        const target = pickRandom(alivePlayers(room).filter((player) => player.role !== "werewolf"));
        if (target) room.game.wolfVotes[wolf.playerId] = target.playerId;
      }
      this.resolveWolfPhase(room);
      return;
    }

    if (room.game.phase === "night_seer") {
      const seer = this.aliveRole(room, "seer")[0];
      const target = seer ? pickRandom(alivePlayers(room).filter((player) => player.playerId !== seer.playerId)) : null;
      if (seer && target) this.resolveSeerPhase(room, seer, target.playerId);
      else {
        this.addMessage(room, "system", "系统", "夜晚行动完成。");
        this.finishNight(room);
      }
      return;
    }

    if (room.game.phase === "day_speech" || room.game.phase === "tie_speech") {
      const current = this.currentSpeaker(room);
      if (current) this.addMessage(room, "system", "系统", `${current.name} 发言超时。`);
      this.nextSpeaker(room);
      return;
    }

    if (room.game.phase === "day_vote") {
      for (const voter of alivePlayers(room)) {
        if (room.game.votes[voter.playerId]) continue;
        const target = pickRandom(this.legalVoteTargets(room, voter));
        room.game.votes[voter.playerId] = target?.playerId ?? ABSTAIN_ID;
      }
      this.resolveVotePhase(room);
    }
  }

  private resolveWolfPhase(room: Room) {
    const killedId = majorityTarget(room.game.wolfVotes);
    room.game.wolfVotes = killedId ? { resolved: killedId } : {};

    this.addMessage(room, "system", "系统", "夜晚行动继续。");
    this.enterPhase(room, "night_seer");

    if (this.aliveRole(room, "seer").length === 0) {
      this.runAi(room, `seer:none:${room.game.day}`, async () => {
        if (room.game.phase !== "night_seer") return;
        if (this.aliveRole(room, "seer").length > 0) return;
        this.addMessage(room, "system", "系统", "夜晚行动完成。");
        this.finishNight(room);
      });
    }
  }

  private resolveSeerPhase(room: Room, seer: PlayerSeat, targetPlayerId: string) {
    const target = getSeatByPlayerId(room, targetPlayerId);
    if (!target?.role) return;
    room.game.seerTarget = targetPlayerId;
    room.game.seerChecks[seer.playerId] = room.game.seerChecks[seer.playerId] ?? [];
    room.game.seerChecks[seer.playerId].push({
      day: room.game.day,
      targetId: targetPlayerId,
      targetName: target.name ?? "Unknown",
      role: target.role
    });
    this.addMessage(room, "system", "系统", "夜晚行动完成。");
    this.finishNight(room);
  }

  private finishNight(room: Room) {
    const killed = getSeatByPlayerId(room, room.game.wolfVotes.resolved ?? null);
    if (killed) {
      killed.alive = false;
      this.addMessage(room, "system", "系统", `天亮了，${killed.name} 昨夜出局。`);
    } else {
      this.addMessage(room, "system", "系统", "天亮了，昨夜无人出局。");
    }

    room.game.wolfVotes = {};
    room.game.seerTarget = null;
    if (this.checkWin(room)) return;
    this.enterPhase(room, "day_speech");
  }

  private nextSpeaker(room: Room) {
    const speechPhase = room.game.phase === "tie_speech" ? "tie_speech" : "day_speech";
    room.game.currentSpeakerIndex += 1;
    const next = this.currentSpeaker(room);
    if (!next) {
      this.enterPhase(room, "day_vote");
      return;
    }

    this.clearTimers(room);
    room.aiTasks.clear();
    room.game.phase = speechPhase;
    room.game.phaseEndsAt = Date.now() + PHASE_SECONDS[speechPhase] * 1000;
    room.timer = setTimeout(() => this.handleTimeout(room.id), PHASE_SECONDS[speechPhase] * 1000);
    room.ticker = setInterval(() => {
      this.io.to(room.id).emit("timer_tick", { roomId: room.id, phaseEndsAt: room.game.phaseEndsAt, now: Date.now() });
    }, 1000);
    this.addMessage(room, "system", "系统", `轮到 ${next.name}${speechPhase === "tie_speech" ? "补充" : ""}发言。`);
    this.broadcast(room);
    this.scheduleAi(room);
  }

  private resolveVotePhase(room: Room) {
    const result = resolvePublicVote(room.game.votes);
    if (!result.winner && room.game.voteRound === 1 && result.tiedPlayers.length >= 2) {
      room.game.tieCandidateIds = result.tiedPlayers;
      room.game.voteRound = 2;
      room.game.votes = {};
      this.enterPhase(room, "tie_speech");
      return;
    }

    const target = result.winner ? getSeatByPlayerId(room, result.winner) : null;
    if (target) {
      target.alive = false;
      this.addMessage(room, "system", "系统", `${target.name} 被投票放逐。`);
    } else {
      this.addMessage(room, "system", "系统", room.game.voteRound === 2 ? "二次投票未形成唯一最高票，本轮无人出局。" : "投票未形成可放逐目标，本轮无人出局。");
    }

    room.game.votes = {};
    room.game.voteRound = 1;
    room.game.tieCandidateIds = [];
    if (this.checkWin(room)) return;
    room.game.day += 1;
    this.addMessage(room, "system", "系统", `第 ${room.game.day} 夜开始。`);
    this.enterPhase(room, "night_wolves");
  }

  private checkWin(room: Room) {
    const alive = alivePlayers(room);
    const wolves = alive.filter((player) => player.role === "werewolf").length;
    const good = alive.length - wolves;

    if (wolves === 0) {
      room.game.winner = "villagers";
      room.game.resultReason = "所有狼人已经出局，好人胜利。";
    } else if (wolves >= good) {
      room.game.winner = "wolves";
      room.game.resultReason = "狼人数量不少于好人，狼人胜利。";
    }

    if (!room.game.winner) return false;
    this.addMessage(room, "system", "系统", room.game.resultReason ?? "游戏结束。");
    this.enterPhase(room, "result");
    this.io.to(room.id).emit("game_over", this.publicState(room));
    return true;
  }

  private scheduleAi(room: Room) {
    if (room.game.phase === "night_wolves") {
      for (const wolf of this.aliveRole(room, "werewolf").filter((seat) => seat.kind === "ai")) {
        this.runAi(room, `wolf-talk:${room.game.day}:${wolf.playerId}`, async () => {
          const text = await aiWolfTalk(room, wolf);
          if (room.game.phase !== "night_wolves" || !wolf.alive) return;
          this.addWolfMessage(room, wolf.name, text, wolf);
          this.broadcast(room);
        });
        this.runAi(room, `wolf:${room.game.day}:${wolf.playerId}`, async () => {
          const target = await aiChooseTarget(room, wolf, "kill");
          if (target && room.game.phase === "night_wolves") {
            room.game.wolfVotes[wolf.playerId] = target;
            this.broadcast(room);
            if (this.allRoleActorsDone(room, "werewolf", room.game.wolfVotes)) this.resolveWolfPhase(room);
          }
        });
      }
      return;
    }

    if (room.game.phase === "night_seer") {
      const seer = this.aliveRole(room, "seer").find((seat) => seat.kind === "ai");
      if (!seer) return;
      this.runAi(room, `seer:${room.game.day}:${seer.playerId}`, async () => {
        const target = await aiChooseTarget(room, seer, "check");
        if (target && room.game.phase === "night_seer") this.resolveSeerPhase(room, seer, target);
      });
      return;
    }

    if (room.game.phase === "day_speech" || room.game.phase === "tie_speech") {
      const speaker = this.currentSpeaker(room);
      if (speaker?.kind !== "ai") return;
      this.runAi(room, `speak:${room.game.phase}:${room.game.day}:${room.game.currentSpeakerIndex}:${speaker.playerId}`, async () => {
        const text = await aiSpeak(room, speaker);
        if (room.game.phase !== "day_speech" && room.game.phase !== "tie_speech") return;
        if (this.currentSpeaker(room)?.playerId !== speaker.playerId) return;
        this.addMessage(room, "speech", speaker.name, text, speaker);
        this.nextSpeaker(room);
      });
      return;
    }

    if (room.game.phase === "day_vote") {
      for (const voter of alivePlayers(room).filter((seat) => seat.kind === "ai" && !room.game.votes[seat.playerId])) {
        this.runAi(room, `vote:${room.game.day}:${voter.playerId}`, async () => {
          const target = await aiChooseTarget(room, voter, "vote");
          if (target && room.game.phase === "day_vote" && this.isLegalVoteTarget(room, voter, target)) {
            room.game.votes[voter.playerId] = target;
            this.broadcast(room);
            if (alivePlayers(room).every((player) => room.game.votes[player.playerId])) this.resolveVotePhase(room);
          }
        });
      }
    }
  }

  private runAi(room: Room, key: string, task: () => Promise<void>) {
    if (room.aiTasks.has(key)) return;
    room.aiTasks.add(key);
    setTimeout(() => task().catch(() => this.broadcast(room)), 700 + Math.floor(Math.random() * 900));
  }

  private publicState(room: Room): RoomState {
    const hostSeat = room.seats.find((seat) => seat.token === room.hostToken);
    const voteSummary: Record<string, number> = {};
    for (const target of Object.values(room.game.votes)) voteSummary[target] = (voteSummary[target] ?? 0) + 1;

    return {
      id: room.id,
      hostSeatIndex: hostSeat?.index ?? null,
      phase: room.game.phase,
      day: room.game.day,
      seats: room.seats.map((seat): PublicSeat => ({
        index: seat.index,
        playerId: seat.playerId,
        kind: seat.kind,
        name: seat.name,
        connected: seat.connected,
        alive: seat.alive,
        isHost: seat.token === room.hostToken,
        model: seat.kind === "ai" ? seat.model : undefined,
        personality: seat.kind === "ai" ? seat.personality : undefined,
        revealedRole: room.game.phase === "result" ? seat.role ?? undefined : undefined
      })),
      messages: room.messages.slice(-100),
      phaseEndsAt: room.game.phaseEndsAt,
      currentSpeakerId: this.currentSpeaker(room)?.playerId ?? null,
      voteSummary,
      voteRound: room.game.voteRound,
      tieCandidateIds: room.game.tieCandidateIds,
      winner: room.game.winner,
      resultReason: room.game.resultReason
    };
  }

  private privateState(room: Room, token: string): PrivateState {
    const seat = getSeatByToken(room, token);
    return {
      roomId: room.id,
      token,
      seatIndex: seat?.index ?? null,
      playerId: seat?.playerId ?? null,
      role: seat?.role ?? null,
      alive: seat?.alive ?? false,
      isHost: isHost(room, token),
      knownWolves:
        seat?.role === "werewolf"
          ? playerSeats(room)
              .filter((player) => player.role === "werewolf")
              .map((player) => ({ playerId: player.playerId, name: player.name, seatIndex: player.index }))
          : [],
      seerChecks: seat?.playerId ? room.game.seerChecks[seat.playerId] ?? [] : [],
      canSpeak: seat ? this.canSpeak(room, seat) : false,
      canVote: Boolean(seat?.alive && seat.playerId && room.game.phase === "day_vote" && !room.game.votes[seat.playerId]),
      canWolfChat: Boolean(seat?.alive && seat.role === "werewolf" && room.game.phase === "night_wolves"),
      canNightAct: Boolean(
        seat?.alive &&
          seat.role &&
          ((room.game.phase === "night_wolves" && seat.role === "werewolf" && seat.playerId && !room.game.wolfVotes[seat.playerId]) ||
            (room.game.phase === "night_seer" && seat.role === "seer" && !room.game.seerTarget))
      ),
      votedFor: seat?.playerId ? room.game.votes[seat.playerId] ?? null : null,
      nightTarget:
        seat?.playerId && room.game.phase === "night_wolves"
          ? room.game.wolfVotes[seat.playerId] ?? null
          : room.game.phase === "night_seer" && seat?.role === "seer"
            ? room.game.seerTarget
            : null,
      wolfMessages: seat?.role === "werewolf" ? room.game.wolfMessages.slice(-80) : []
    };
  }

  private broadcast(room: Room) {
    const state = this.publicState(room);
    this.io.to(room.id).emit("room_state", state);
    for (const [socketId, connection] of this.connections.entries()) {
      if (connection.roomId === room.id) {
        this.io.to(socketId).emit("private_state", this.privateState(room, connection.token));
      }
    }
  }

  private addMessage(room: Room, type: ChatMessage["type"], author: string, text: string, seat?: Seat) {
    const message: ChatMessage = {
      id: createId("msg_"),
      type,
      author,
      seatIndex: seat?.index,
      playerId: seat?.playerId ?? undefined,
      text,
      createdAt: Date.now()
    };
    room.messages.push(message);
    if (room.messages.length > 180) room.messages.splice(0, room.messages.length - 180);
    this.io.to(room.id).emit("chat_message", message);
  }

  private addWolfMessage(room: Room, author: string, text: string, seat?: Seat) {
    const message: ChatMessage = {
      id: createId("wolf_"),
      type: "wolf",
      author,
      seatIndex: seat?.index,
      playerId: seat?.playerId ?? undefined,
      text,
      createdAt: Date.now()
    };
    room.game.wolfMessages.push(message);
    if (room.game.wolfMessages.length > 120) room.game.wolfMessages.splice(0, room.game.wolfMessages.length - 120);
  }

  private attachSocket(socket: IOSocket, room: Room, token: string) {
    const previous = this.connections.get(socket.id);
    if (previous) socket.leave(previous.roomId);
    socket.join(room.id);
    this.connections.set(socket.id, { roomId: room.id, token });
  }

  private disconnect(socket: IOSocket) {
    const connection = this.connections.get(socket.id);
    this.connections.delete(socket.id);
    if (!connection) return;
    const room = this.rooms.get(connection.roomId);
    if (!room) return;

    const hasOtherSocket = [...this.connections.values()].some(
      (item) => item.roomId === room.id && item.token === connection.token
    );
    if (!hasOtherSocket) {
      const seat = getSeatByToken(room, connection.token);
      if (seat) seat.connected = false;
    }
    this.broadcast(room);
  }

  private withRoom(socket: IOSocket, roomId: string, handler: (room: Room) => void) {
    const room = this.findRoom(roomId);
    if (!room) {
      socket.emit("error_message", { message: "房间不存在。" });
      return;
    }
    handler(room);
  }

  private findRoom(roomId: string) {
    return this.rooms.get(roomId.trim().toUpperCase()) ?? null;
  }

  private requireHost(room: Room, token: string) {
    if (isHost(room, token)) return true;
    this.action(room, token, false, "只有房主可以这样操作。");
    return false;
  }

  private action(room: Room, token: string, ok: boolean, message: string) {
    for (const [socketId, connection] of this.connections.entries()) {
      if (connection.roomId === room.id && connection.token === token) {
        this.io.to(socketId).emit("action_result", { ok, message });
      }
    }
  }

  private clearTimers(room: Room) {
    if (room.timer) clearTimeout(room.timer);
    if (room.ticker) clearInterval(room.ticker);
    room.timer = null;
    room.ticker = null;
  }

  private aliveRole(room: Room, role: Role) {
    return alivePlayers(room).filter((player) => player.role === role);
  }

  private currentSpeaker(room: Room): PlayerSeat | null {
    const playerId = room.game.speechOrder[room.game.currentSpeakerIndex];
    return (getSeatByPlayerId(room, playerId) as PlayerSeat | null) ?? null;
  }

  private canSpeak(room: Room, seat: Seat) {
    return Boolean(
      seat.playerId &&
        seat.alive &&
        (room.game.phase === "day_speech" || room.game.phase === "tie_speech") &&
        this.currentSpeaker(room)?.playerId === seat.playerId
    );
  }

  private isLegalTarget(room: Room, actor: Seat, targetPlayerId: string) {
    const target = getSeatByPlayerId(room, targetPlayerId);
    if (!target?.alive || target.playerId === actor.playerId) return false;
    if (room.game.phase === "night_wolves" && actor.role === "werewolf") return target.role !== "werewolf";
    return true;
  }

  private legalVoteTargets(room: Room, actor: Seat) {
    return alivePlayers(room).filter((target) => {
      if (target.playerId === actor.playerId) return false;
      if (room.game.voteRound === 2 && room.game.tieCandidateIds.length > 0) {
        return room.game.tieCandidateIds.includes(target.playerId);
      }
      return true;
    });
  }

  private isLegalVoteTarget(room: Room, actor: Seat, targetPlayerId: string) {
    if (targetPlayerId === ABSTAIN_ID) return true;
    return this.legalVoteTargets(room, actor).some((target) => target.playerId === targetPlayerId);
  }

  private allRoleActorsDone(room: Room, role: Role, actions: Record<string, string>) {
    return this.aliveRole(room, role).every((player) => Boolean(actions[player.playerId]));
  }

  private cleanToken(token: string) {
    return token?.trim() || createId("human_");
  }

  private cleanName(name: string, fallback: string) {
    const clean = name.trim().replace(/\s+/g, " ").slice(0, 16);
    return clean || fallback;
  }

  private makeEmptySeat(index: number): Seat {
    return {
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
    };
  }

  private makeHumanSeat(index: number, token: string, name: string, playerId = createId(`human_${index}_`)): Seat {
    return {
      index,
      kind: "human",
      playerId,
      token,
      name,
      connected: true,
      role: null,
      alive: false,
      model: "deepseek-v4-flash",
      personality: ""
    };
  }

  private makeAiSeat(index: number): Seat {
    return {
      index,
      kind: "ai",
      playerId: createId(`ai_${index}_`),
      token: null,
      name: randomAiName(),
      connected: true,
      role: null,
      alive: false,
      model: "deepseek-v4-flash",
      personality: "冷静、少说废话、会观察票型"
    };
  }
}
