import { ABSTAIN_ID } from "../types/shared";
import type { PlayerSeat, Room } from "./types";
import { alivePlayers, getSeatByPlayerId, pickRandom } from "./utils";

type ChatCompletion = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

function apiConfig() {
  return {
    baseURL: process.env.OPENAI_BASE_URL || "http://jink.xin:8101/v1",
    apiKey: process.env.OPENAI_API_KEY || "",
    defaultModel: process.env.DEFAULT_AI_MODEL || "deepseek-v4-flash"
  };
}

function roleName(role: string | null) {
  if (role === "werewolf") return "狼人";
  if (role === "seer") return "预言家";
  return "村民";
}

function visibleBrief(room: Room, seat: PlayerSeat) {
  const players = alivePlayers(room)
    .map((player) => `${player.playerId}:${player.name}${player.playerId === seat.playerId ? "(你)" : ""}`)
    .join("\n");
  const publicChat = room.messages
    .slice(-24)
    .map((message) => `${message.author}: ${message.text}`)
    .join("\n");
  const wolves =
    seat.role === "werewolf"
      ? room.seats
          .filter((player) => player.role === "werewolf" && player.playerId)
          .map((player) => `${player.playerId}:${player.name}`)
          .join("\n")
      : "无";
  const checks =
    seat.role === "seer"
      ? (room.game.seerChecks[seat.playerId] ?? [])
          .map((check) => `第${check.day}天 ${check.targetName}: ${roleName(check.role)}`)
          .join("\n") || "无"
      : "无";
  const wolfChat =
    seat.role === "werewolf"
      ? room.game.wolfMessages
          .slice(-12)
          .map((message) => `${message.author}: ${message.text}`)
          .join("\n") || "无"
      : "无";

  return [
    `房间:${room.id}`,
    `阶段:${room.game.phase}`,
    `天数:${room.game.day}`,
    `你的名字:${seat.name}`,
    `你的身份:${roleName(seat.role)}`,
    `你的人格:${seat.personality || "冷静、简洁、愿意推进局势"}`,
    `存活玩家:\n${players}`,
    `狼人队友(只有狼人可见):\n${wolves}`,
    `查验记录(只有预言家可见):\n${checks}`,
    `狼队夜聊(只有狼人可见):\n${wolfChat}`,
    `公开聊天:\n${publicChat || "暂无"}`
  ].join("\n\n");
}

async function chatCompletion(model: string, content: string) {
  const { baseURL, apiKey, defaultModel } = apiConfig();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing");
  }

  const response = await fetch(`${baseURL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || defaultModel,
      messages: [
        {
          role: "system",
          content:
            "你是狼人杀玩家。不要输出思考过程，不要泄露未提供的信息。只基于用户给你的可见信息行动。"
        },
        { role: "user", content }
      ],
      temperature: 0.7
    })
  });

  if (!response.ok) {
    throw new Error(`AI request failed: ${response.status}`);
  }

  const data = (await response.json()) as ChatCompletion;
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("AI returned empty content");
  }
  return text;
}

function parseJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced ?? text;
  const match = source.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function aiSpeak(room: Room, seat: PlayerSeat) {
  try {
    const text = await chatCompletion(
      seat.model,
      `${visibleBrief(room, seat)}

现在轮到你白天发言。请输出 JSON：{"text":"你的最终发言"}。发言用中文，40到90字，像真人玩家一样简洁。`
    );
    const json = parseJson(text);
    const finalText = typeof json?.text === "string" ? json.text : text;
    return finalText.replace(/\s+/g, " ").slice(0, 180);
  } catch {
    return "我先保守听一轮。目前信息还不够，我会重点看投票和发言前后是否一致。";
  }
}

export async function aiWolfTalk(room: Room, seat: PlayerSeat) {
  try {
    const text = await chatCompletion(
      seat.model,
      `${visibleBrief(room, seat)}

现在是狼人夜晚行动阶段，你可以和狼队队友简短交流击杀倾向。请输出 JSON：{"text":"给狼队看的最终发言"}。不要超过50字，不要输出思考过程。`
    );
    const json = parseJson(text);
    const finalText = typeof json?.text === "string" ? json.text : text;
    return finalText.replace(/\s+/g, " ").slice(0, 100);
  } catch {
    return "我倾向先刀发言稳定的人，避免留下能带队的位置。";
  }
}

export async function aiChooseTarget(room: Room, seat: PlayerSeat, purpose: "kill" | "check" | "vote") {
  const legalTargets = alivePlayers(room).filter((player) => {
    if (player.playerId === seat.playerId) return false;
    if (purpose === "kill" && seat.role === "werewolf") return player.role !== "werewolf";
    if (purpose === "vote" && room.game.voteRound === 2 && room.game.tieCandidateIds.length > 0) {
      return room.game.tieCandidateIds.includes(player.playerId);
    }
    return true;
  });
  const allowAbstain = purpose === "vote";
  if (legalTargets.length === 0 && !allowAbstain) {
    return null;
  }

  try {
    const candidates = [
      ...legalTargets.map((player) => `${player.playerId}:${player.name}`),
      ...(allowAbstain ? [`${ABSTAIN_ID}:弃票`] : [])
    ].join("\n");
    const label = purpose === "kill" ? "夜晚击杀" : purpose === "check" ? "预言家查验" : "白天投票放逐";
    const text = await chatCompletion(
      seat.model,
      `${visibleBrief(room, seat)}

你要进行${label}。合法目标如下：
${candidates}

请只输出 JSON：{"targetPlayerId":"目标playerId"}。`
    );
    const json = parseJson(text);
    const targetPlayerId = typeof json?.targetPlayerId === "string" ? json.targetPlayerId : "";
    if (allowAbstain && targetPlayerId === ABSTAIN_ID) {
      return ABSTAIN_ID;
    }
    if (legalTargets.some((player) => player.playerId === targetPlayerId)) {
      return targetPlayerId;
    }

    const named = legalTargets.find((player) => text.includes(player.name));
    if (allowAbstain && text.includes("弃票")) return ABSTAIN_ID;
    return named?.playerId ?? pickRandom(legalTargets)?.playerId ?? (allowAbstain ? ABSTAIN_ID : null);
  } catch {
    return pickRandom(legalTargets)?.playerId ?? (allowAbstain ? ABSTAIN_ID : null);
  }
}

export function describeTarget(room: Room, playerId: string | null) {
  if (playerId === ABSTAIN_ID) return "弃票";
  return getSeatByPlayerId(room, playerId)?.name ?? "未知玩家";
}
