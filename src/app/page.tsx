"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { DoorOpen, Moon, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { getOrCreateToken, getSavedName, getSocket, saveName } from "@/lib/socket";

export default function HomePage() {
  const router = useRouter();
  const socket = useMemo(() => getSocket(), []);
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setName(getSavedName());
    getOrCreateToken();
  }, []);

  function createRoom() {
    setBusy(true);
    setError("");
    const token = getOrCreateToken();
    const savedName = saveName(name);
    setName(savedName);
    socket.emit("create_room", { token, name: savedName }, (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      router.push(`/room/${response.data.roomId}`);
    });
  }

  function joinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = roomId.trim().toUpperCase();
    if (!code) return;
    const savedName = saveName(name);
    setName(savedName);
    router.push(`/room/${code}`);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center overflow-hidden bg-[var(--bg)] px-5 py-8 text-[var(--text)]">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <section className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] shadow-sm">
            <Moon size={22} className="text-[var(--accent)]" />
          </div>
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--text-dim)]">Werewolf AI Room</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">狼人杀</h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">真人和 AI 混合的一局简化狼人杀。</p>
        </div>

        <div className="space-y-3">
          <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] p-4 shadow-sm">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-dim)]">Name</label>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={16}
              className="mb-4 w-full rounded-lg border border-[var(--border-soft)] bg-[var(--bg-soft)] px-3 py-3 text-sm outline-none focus:border-[var(--accent)]/50"
              placeholder="Player name"
            />
            <button
              onClick={createRoom}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Plus size={17} />
              创建房间
            </button>
            {error && <p className="mt-3 text-center text-xs text-[var(--danger)]">{error}</p>}
          </section>

          <form onSubmit={joinRoom} className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] p-4 shadow-sm">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-dim)]">Room code</label>
            <input
              value={roomId}
              onChange={(event) => setRoomId(event.target.value.toUpperCase())}
              className="mb-4 w-full rounded-lg border border-[var(--border-soft)] bg-[var(--bg-soft)] px-3 py-3 font-mono text-lg uppercase tracking-[0.16em] outline-none focus:border-[var(--accent)]/50"
              placeholder="ABCDE"
            />
            <button className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-soft)] px-4 py-3 text-sm font-semibold text-[var(--text-muted)] hover:text-[var(--text)]">
              <DoorOpen size={17} />
              加入房间
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-[var(--text-dim)]">至少 6 人可开始，8 人体验最佳。</p>
      </section>
    </main>
  );
}
