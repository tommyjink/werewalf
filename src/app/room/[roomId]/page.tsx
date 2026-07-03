"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Copy, Crown, DoorOpen, MessageCircle, Play, Send, Skull, User, Vote } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import clsx from "clsx";
import { ThemeToggle } from "@/components/theme-toggle";
import { getOrCreateToken, getSavedName, getSocket, saveName } from "@/lib/socket";
import { ABSTAIN_ID, AI_MODELS, MIN_PLAYERS, type AiModel, type PrivateState, type PublicSeat, type Role, type RoomState } from "@/types/shared";

const phaseText: Record<RoomState["phase"], string> = {
  lobby: "房间大厅",
  night_wolves: "夜晚 · 狼人行动",
  night_seer: "夜晚 · 预言家查验",
  day_speech: "白天 · 发言",
  tie_speech: "白天 · 平票发言",
  day_vote: "白天 · 投票",
  result: "游戏结束"
};

const roleText: Record<Role, string> = {
  werewolf: "狼人",
  seer: "预言家",
  villager: "村民"
};

const PERSONALITY_PRESETS = [
  { label: "冷静", value: "冷静、少说废话、会观察票型" },
  { label: "推进", value: "强势推进、喜欢质疑矛盾点" },
  { label: "谨慎", value: "谨慎保守、先听发言再判断" },
  { label: "活跃", value: "活跃外向、会带动讨论" },
  { label: "低调", value: "低调隐忍、尽量不暴露立场" },
  { label: "直觉", value: "偏直觉流，会快速给出怀疑对象" }
];

function labelSeat(seat: PublicSeat) {
  return seat.kind === "empty" ? "空位" : seat.name || `Seat ${seat.index + 1}`;
}

function timerText(phaseEndsAt: number | null, now: number) {
  if (!phaseEndsAt) return "--";
  return String(Math.max(0, Math.ceil((phaseEndsAt - now) / 1000))).padStart(2, "0");
}

function roleLabel(role: Role | null) {
  return role ? roleText[role] : "未发放";
}

export default function RoomPage() {
  const params = useParams<{ roomId: string }>();
  const router = useRouter();
  const roomId = String(params.roomId || "").toUpperCase();
  const socket = useMemo(() => getSocket(), []);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [me, setMe] = useState<PrivateState | null>(null);
  const [name, setName] = useState("Player");
  const [text, setText] = useState("");
  const [wolfText, setWolfText] = useState("");
  const [notice, setNotice] = useState("");
  const [joinError, setJoinError] = useState("");
  const [now, setNow] = useState(Date.now());
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const token = getOrCreateToken();
    const savedName = getSavedName();
    setName(savedName);
    socket.emit("join_room", { roomId, token, name: savedName }, (response) => {
      if (!response.ok) setJoinError(response.error);
    });

    const onRoom = (next: RoomState) => {
      setRoom(next);
      setJoinError("");
    };
    const onPrivate = (next: PrivateState) => setMe(next);
    const onNotice = (payload: { message: string }) => setNotice(payload.message);
    const onTimer = (payload: { now: number }) => setNow(payload.now);

    socket.on("room_state", onRoom);
    socket.on("private_state", onPrivate);
    socket.on("action_result", onNotice);
    socket.on("error_message", onNotice);
    socket.on("timer_tick", onTimer);

    return () => {
      socket.off("room_state", onRoom);
      socket.off("private_state", onPrivate);
      socket.off("action_result", onNotice);
      socket.off("error_message", onNotice);
      socket.off("timer_tick", onTimer);
    };
  }, [roomId, socket]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [room?.messages.length]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(""), 2200);
    return () => window.clearTimeout(id);
  }, [notice]);

  function token() {
    return getOrCreateToken();
  }

  function commitName() {
    const savedName = saveName(name);
    setName(savedName);
    if (room?.phase === "lobby" && me && me.seatIndex !== null) {
      socket.emit("claim_seat", { roomId, token: token(), seatIndex: me.seatIndex, name: savedName });
    }
  }

  async function copyLink() {
    const link = window.location.href;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
        setNotice("房间链接已复制。");
        return;
      }

      const input = document.createElement("textarea");
      input.value = link;
      input.setAttribute("readonly", "true");
      input.style.position = "fixed";
      input.style.left = "-9999px";
      document.body.appendChild(input);
      input.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(input);
      setNotice(copied ? "房间链接已复制。" : "复制失败，请手动复制地址栏。");
    } catch {
      setNotice("复制失败，请手动复制地址栏。");
    }
  }

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim()) return;
    socket.emit("send_message", { roomId, token: token(), text });
    setText("");
  }

  function sendWolfMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!wolfText.trim()) return;
    socket.emit("wolf_message", { roomId, token: token(), text: wolfText });
    setWolfText("");
  }

  if (joinError) {
    return (
      <main className="flex h-dvh items-center justify-center overflow-hidden bg-[var(--bg)] px-4 text-[var(--text)]">
        <section className="w-full max-w-sm rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5 text-center shadow-lg">
          <p className="mb-4 text-sm text-[var(--danger)]">{joinError}</p>
          <button
            onClick={() => router.push("/")}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
          >
            <DoorOpen size={16} />
            返回首页
          </button>
        </section>
      </main>
    );
  }

  if (!room || !me) {
    return (
      <main className="flex h-dvh items-center justify-center overflow-hidden bg-[var(--bg)] text-sm text-[var(--text-muted)]">
        正在进入房间...
      </main>
    );
  }

  const isHost = me.isHost;
  const mySeat = room.seats.find((seat) => seat.index === me.seatIndex) ?? null;
  const currentSpeaker = room.seats.find((seat) => seat.playerId === room.currentSpeakerId) ?? null;
  const playerCount = room.seats.filter((seat) => seat.kind !== "empty").length;
  const canChat = room.phase === "lobby" || me.canSpeak;
  const targets = room.seats.filter((seat) => {
    if (!seat.playerId || !seat.alive || seat.playerId === me.playerId) return false;
    if (room.phase === "day_vote" && room.voteRound === 2 && room.tieCandidateIds.length > 0) {
      return room.tieCandidateIds.includes(seat.playerId);
    }
    if (room.phase === "night_wolves" && me.role === "werewolf") {
      return !me.knownWolves.some((wolf) => wolf.playerId === seat.playerId);
    }
    return true;
  });

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      {notice && (
        <div className="fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--accent)] shadow-lg">
          {notice}
        </div>
      )}

      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded-md bg-[var(--accent-dim)] px-2 py-1 font-mono text-xs font-semibold text-[var(--accent)]">
            {room.id}
          </span>
          <span className="truncate text-sm font-semibold">{phaseText[room.phase]}</span>
          <span className="hidden rounded-full border border-[var(--border-soft)] px-2 py-0.5 font-mono text-xs text-[var(--text-muted)] sm:inline">
            {timerText(room.phaseEndsAt, now)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <ThemeToggle />
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={commitName}
            maxLength={16}
            className="hidden w-28 rounded-md border border-[var(--border-soft)] bg-[var(--bg-soft)] px-2 py-1.5 text-xs outline-none sm:block"
          />
          <button
            onClick={copyLink}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border-soft)] text-[var(--text-muted)] hover:bg-[var(--bg-soft)] hover:text-[var(--text)]"
            title="复制链接"
          >
            <Copy size={15} />
          </button>
          <button
            onClick={() => router.push("/")}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border-soft)] text-[var(--text-muted)] hover:bg-[var(--bg-soft)] hover:text-[var(--text)]"
            title="离开"
          >
            <DoorOpen size={15} />
          </button>
        </div>
      </header>

      <section className="grid min-h-0 flex-1 grid-rows-[24%_minmax(0,1fr)_32%] overflow-hidden lg:grid-cols-[292px_minmax(0,1fr)_328px] lg:grid-rows-none lg:divide-x lg:divide-[var(--border)]">
        <aside className="thin-scrollbar min-h-0 overflow-y-auto bg-[var(--bg-soft)]">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-soft)]/95 px-3 py-2 backdrop-blur">
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-dim)]">Seats</p>
              <p className="text-xs text-[var(--text-muted)]">{playerCount}/8 players · min {MIN_PLAYERS}</p>
            </div>
            {isHost && room.phase === "lobby" && (
              <button
                onClick={() => socket.emit("start_game", { roomId, token: token() })}
                className="inline-flex items-center gap-1 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white"
              >
                <Play size={13} />
                开始
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 p-2 lg:grid-cols-1">
            {room.seats.map((seat) => (
              <SeatRow
                key={seat.index}
                seat={seat}
                isMine={seat.index === me.seatIndex}
                isHost={isHost}
                phase={room.phase}
                onClaim={() => {
                  const savedName = saveName(name);
                  setName(savedName);
                  socket.emit("claim_seat", { roomId, token: token(), seatIndex: seat.index, name: savedName });
                }}
                onSetAi={() => socket.emit("set_seat", { roomId, token: token(), seatIndex: seat.index, kind: "ai" })}
                onRemoveAi={() => socket.emit("set_seat", { roomId, token: token(), seatIndex: seat.index, kind: "empty" })}
                onConfigure={(model, personality) =>
                  socket.emit("configure_ai", { roomId, token: token(), seatIndex: seat.index, model, personality })
                }
              />
            ))}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden bg-[var(--surface)]">
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--border)] px-3">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Log</p>
              {(room.phase === "day_speech" || room.phase === "tie_speech") && currentSpeaker && (
                <span className="rounded bg-[var(--accent-dim)] px-2 py-0.5 text-xs text-[var(--accent)]">
                  {labelSeat(currentSpeaker)} {room.phase === "tie_speech" ? "补充发言" : "发言"}
                </span>
              )}
            </div>
            <span className="font-mono text-xs text-[var(--text-dim)]">Day {room.day}</span>
          </div>

          <div className="thin-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {room.messages.length === 0 && (
              <div className="mt-10 text-center text-sm text-[var(--text-dim)]">还没有消息。</div>
            )}
            {room.messages.map((message) => (
              <article
                key={message.id}
                className={clsx(
                  "rounded-lg border px-3 py-2",
                  message.type === "system"
                    ? "border-transparent bg-[var(--bg-soft)] text-[var(--text-muted)]"
                    : "border-[var(--accent)]/20 bg-[var(--accent-dim)]"
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className={clsx("truncate text-xs font-semibold", message.type === "system" ? "text-[var(--text-dim)]" : "text-[var(--accent)]")}>
                    {message.author}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-[var(--text-dim)]">
                    {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <p className="break-words text-sm leading-6">{message.text}</p>
              </article>
            ))}
            <div ref={endRef} />
          </div>

          <form onSubmit={sendMessage} className="flex h-14 shrink-0 gap-2 border-t border-[var(--border)] p-2">
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              disabled={!canChat}
              maxLength={300}
              className="min-w-0 flex-1 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-soft)] px-3 text-sm outline-none disabled:opacity-45"
              placeholder={canChat ? "输入发言..." : "等待你的回合"}
            />
            <button
              disabled={!canChat || !text.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white disabled:opacity-35"
            >
              <Send size={15} />
              发送
            </button>
          </form>
        </section>

        <aside className="thin-scrollbar min-h-0 overflow-y-auto bg-[var(--bg-soft)] p-3">
          <Panel title="状态">
            <div className="grid grid-cols-3 gap-2">
              <Stat label="身份" value={roleLabel(me.role)} />
              <Stat label="状态" value={mySeat?.alive ? "存活" : room.phase === "lobby" ? "待开始" : "出局"} />
              <Stat label="倒计时" value={timerText(room.phaseEndsAt, now)} />
            </div>
            {(room.phase === "day_speech" || room.phase === "tie_speech") && (
              <p className="mt-3 rounded-md bg-[var(--bg-soft)] px-3 py-2 text-xs text-[var(--text-muted)]">
                当前发言：<span className="font-semibold text-[var(--text)]">{currentSpeaker ? labelSeat(currentSpeaker) : "无"}</span>
              </p>
            )}
          </Panel>

          <Panel title={me.canNightAct ? "选择夜晚目标" : me.canVote ? "投票放逐" : "行动"}>
            {me.canNightAct || me.canVote ? (
              <div className="space-y-2">
                {me.canVote && room.voteRound === 2 && (
                  <p className="rounded-md bg-[var(--warn-dim)] px-3 py-2 text-xs leading-5 text-[var(--warn)]">
                    二次投票：只能投平票玩家，也可以弃票。再平票无人出局。
                  </p>
                )}
                {targets.map((target) => (
                  <button
                    key={target.playerId}
                    onClick={() =>
                      me.canNightAct
                        ? socket.emit("night_action", { roomId, token: token(), targetPlayerId: target.playerId! })
                        : socket.emit("vote", { roomId, token: token(), targetPlayerId: target.playerId! })
                    }
                    className="flex w-full items-center justify-between rounded-lg border border-[var(--border-soft)] bg-[var(--bg)] px-3 py-2 text-left text-sm hover:border-[var(--accent)]/50 hover:bg-[var(--accent-dim)]"
                  >
                    <span>{labelSeat(target)}</span>
                    <Vote size={15} className="text-[var(--accent)]" />
                  </button>
                ))}
                {me.canVote && (
                  <button
                    onClick={() => socket.emit("vote", { roomId, token: token(), targetPlayerId: ABSTAIN_ID })}
                    className="flex w-full items-center justify-between rounded-lg border border-[var(--border-soft)] bg-[var(--bg-soft)] px-3 py-2 text-left text-sm text-[var(--text-muted)] hover:border-[var(--warn)]/50 hover:bg-[var(--warn-dim)] hover:text-[var(--text)]"
                  >
                    <span>弃票</span>
                    <Vote size={15} className="text-[var(--warn)]" />
                  </button>
                )}
              </div>
            ) : (
              <p className="text-sm leading-6 text-[var(--text-muted)]">
                {room.phase === "lobby"
                  ? "房主配置座位后开始游戏。"
                  : me.canSpeak
                    ? "轮到你发言。"
                    : "当前无需操作。"}
              </p>
            )}
            {me.canSpeak && (
              <button
                onClick={() => socket.emit("advance_speech", { roomId, token: token() })}
                className="mt-3 w-full rounded-lg border border-[var(--border-soft)] px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg)]"
              >
                跳过发言
              </button>
            )}
          </Panel>

          {me.canWolfChat && (
            <Panel title="狼队夜聊">
              <div className="thin-scrollbar mb-2 max-h-32 space-y-2 overflow-y-auto rounded-md border border-[var(--danger)]/20 bg-[var(--danger-dim)] p-2">
                {me.wolfMessages.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)]">暂无夜聊。</p>
                ) : (
                  me.wolfMessages.map((message) => (
                    <div key={message.id} className="text-xs leading-5">
                      <span className="font-semibold text-[var(--danger)]">{message.author}</span>
                      <span className="ml-2 text-[var(--text)]">{message.text}</span>
                    </div>
                  ))
                )}
              </div>
              <form onSubmit={sendWolfMessage} className="flex gap-2">
                <input
                  value={wolfText}
                  onChange={(event) => setWolfText(event.target.value)}
                  maxLength={220}
                  className="min-w-0 flex-1 rounded-md border border-[var(--border-soft)] bg-[var(--bg)] px-2 py-2 text-xs outline-none"
                  placeholder="只发给狼人队友"
                />
                <button
                  disabled={!wolfText.trim()}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-[var(--danger)] text-white disabled:opacity-35"
                  title="发送狼队消息"
                >
                  <MessageCircle size={15} />
                </button>
              </form>
            </Panel>
          )}

          <Panel title="私有情报">
            {me.knownWolves.length > 0 && (
              <InfoLine label="狼人队友" value={me.knownWolves.map((wolf) => wolf.name).join(" / ")} danger />
            )}
            {me.seerChecks.length > 0 ? (
              <div className="space-y-2">
                {me.seerChecks.map((check) => (
                  <InfoLine key={`${check.day}-${check.targetName}`} label={`Day ${check.day}`} value={`${check.targetName} 是 ${roleText[check.role]}`} />
                ))}
              </div>
            ) : me.knownWolves.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">暂无额外信息。</p>
            ) : null}
          </Panel>

          {room.phase === "day_vote" && Object.keys(room.voteSummary).length > 0 && (
            <Panel title="票型">
              <div className="space-y-2">
                {Object.entries(room.voteSummary).map(([playerId, count]) => {
                  const seat = room.seats.find((item) => item.playerId === playerId);
                  return <InfoLine key={playerId} label={playerId === ABSTAIN_ID ? "弃票" : seat ? labelSeat(seat) : "未知"} value={`${count} 票`} />;
                })}
              </div>
            </Panel>
          )}

          {room.phase === "result" && (
            <Panel title="结果">
              <p className={clsx("text-lg font-semibold", room.winner === "villagers" ? "text-[var(--accent)]" : "text-[var(--danger)]")}>
                {room.winner === "villagers" ? "好人胜利" : "狼人胜利"}
              </p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">{room.resultReason}</p>
            </Panel>
          )}
        </aside>
      </section>
    </main>
  );
}

function SeatRow({
  seat,
  isMine,
  isHost,
  phase,
  onClaim,
  onSetAi,
  onRemoveAi,
  onConfigure
}: {
  seat: PublicSeat;
  isMine: boolean;
  isHost: boolean;
  phase: RoomState["phase"];
  onClaim: () => void;
  onSetAi: () => void;
  onRemoveAi: () => void;
  onConfigure: (model: AiModel, personality: string) => void;
}) {
  return (
    <div
      className={clsx(
        "rounded-lg border p-2",
        isMine ? "border-[var(--accent)] bg-[var(--accent-dim)]" : "border-[var(--border-soft)] bg-[var(--surface)]"
      )}
    >
      <div className="flex items-center gap-2">
        {seat.kind === "ai" ? <Bot size={15} className="text-[var(--warn)]" /> : seat.kind === "human" ? <User size={15} /> : <span className="h-[15px] w-[15px]" />}
        <span className={clsx("min-w-0 flex-1 truncate text-sm", seat.kind === "empty" && "text-[var(--text-muted)]")}>{labelSeat(seat)}</span>
        {seat.isHost && <Crown size={13} className="text-[var(--warn)]" />}
        {seat.alive ? <span className="h-2 w-2 rounded-full bg-[var(--accent)]" /> : seat.kind !== "empty" && phase !== "lobby" ? <Skull size={14} className="text-[var(--danger)]" /> : null}
      </div>

      {seat.revealedRole && <p className="mt-1 text-xs text-[var(--accent)]">身份：{roleText[seat.revealedRole]}</p>}

      {phase === "lobby" && (
        <div className="mt-2 space-y-2">
          {seat.kind === "empty" && (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={onClaim} className="rounded-md border border-[var(--border-soft)] py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-soft)]">
                坐下
              </button>
              {isHost && (
                <button onClick={onSetAi} className="rounded-md border border-[var(--warn)]/40 py-1 text-xs text-[var(--warn)] hover:bg-[var(--warn-dim)]">
                  设 AI
                </button>
              )}
            </div>
          )}
          {seat.kind === "ai" && isHost && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-1 rounded-md border border-[var(--border-soft)] bg-[var(--bg-soft)] p-1">
                {AI_MODELS.map((model) => (
                  <button
                    key={model}
                    type="button"
                    onClick={() => onConfigure(model, seat.personality || "")}
                    className={clsx(
                      "min-w-0 truncate rounded px-2 py-1.5 text-[10px] font-semibold",
                      seat.model === model ? "bg-[var(--surface)] text-[var(--accent)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text)]"
                    )}
                    title={model}
                  >
                    {model.replace("deepseek-v4-", "")}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-1">
                {PERSONALITY_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => onConfigure(seat.model || "deepseek-v4-flash", preset.value)}
                    className={clsx(
                      "rounded-md border px-2 py-1.5 text-xs transition",
                      seat.personality === preset.value
                        ? "border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]"
                        : "border-[var(--border-soft)] bg-[var(--bg-soft)] text-[var(--text-muted)] hover:text-[var(--text)]"
                    )}
                    title={preset.value}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  key={seat.personality || "empty-personality"}
                  defaultValue={seat.personality}
                  onBlur={(event) => onConfigure(seat.model || "deepseek-v4-flash", event.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-[var(--border-soft)] bg-[var(--bg-soft)] px-2 py-1 text-xs"
                  placeholder="自定义 AI 人格"
                />
                <button onClick={onRemoveAi} className="rounded-md border border-[var(--danger)]/40 px-2 text-xs text-[var(--danger)] hover:bg-[var(--danger-dim)]">
                  移除
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-3 rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-3">
      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-dim)]">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-[var(--bg-soft)] px-2 py-2">
      <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-dim)]">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold">{value}</p>
    </div>
  );
}

function InfoLine({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className={clsx("rounded-md px-3 py-2 text-sm", danger ? "bg-[var(--danger-dim)]" : "bg-[var(--bg-soft)]")}>
      <p className={clsx("text-[10px] uppercase tracking-[0.12em]", danger ? "text-[var(--danger)]" : "text-[var(--text-dim)]")}>{label}</p>
      <p className="mt-1 break-words font-medium">{value}</p>
    </div>
  );
}
