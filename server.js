"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const ROOM_LIFETIME_MS = 12 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const rooms = new Map();
const globalChat = [];
const globalChatTimes = new Map();
const MAX_GLOBAL_CHAT_MESSAGES = 100;
const MAX_MATCH_HISTORY = 8;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-flash";
const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/chat/completions";

const FALLBACK_THEMES = [
  { target: "海风", clue: "来自辽阔水面，带着盐和远方的气息", category: "自然" },
  { target: "路灯", clue: "天黑以后站在街边，为晚归的人照亮一小块地方", category: "城市" },
  { target: "旧照片", clue: "颜色会慢慢变淡，却把某一天留在纸面上", category: "生活" },
  { target: "风筝", clue: "需要一根线，也需要一阵向上的风", category: "童年" },
  { target: "早班车", clue: "天刚亮时出发，常常装着一群还没完全醒的人", category: "日常" },
  { target: "雨后", clue: "空气突然变清，地面上还留着许多小水洼", category: "天气" },
  { target: "耳机", clue: "把世界调小，让另一个声音靠近", category: "物件" },
  { target: "便利店", clue: "深夜仍然亮着灯，总能买到一点急需的东西", category: "城市" },
  { target: "候鸟", clue: "随着季节改变方向，在很远的地方之间往返", category: "自然" },
  { target: "毕业照", clue: "很多人站在一起，留下学生时代的最后一天", category: "记忆" },
  { target: "厨房", clue: "有热气、香味和锅碗碰撞声的小空间", category: "家庭" },
  { target: "回声", clue: "你发出声音以后，过一会儿又听见相似的自己", category: "声音" },
  { target: "夜航船", clue: "四周很黑，水面发亮，慢慢驶向远处的灯火", category: "旅行" },
  { target: "植物园", clue: "很多不同形状的叶子被集中照顾、供人参观", category: "地点" },
  { target: "纸飞机", clue: "轻得能被吹走，却总想飞过一张课桌的距离", category: "童年" },
  { target: "热汤", clue: "天气很冷时端上来，先暖手，再慢慢暖到胃里", category: "食物" }
];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function sendError(response, statusCode, message, code) {
  sendJson(response, statusCode, {
    ok: false,
    error: message,
    code: code || "REQUEST_FAILED"
  });
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        const error = new Error("请求内容过大");
        error.statusCode = 413;
        reject(error);
        request.destroy();
        return;
      }
      body += chunk;
    });

    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        const error = new Error("请求格式不正确");
        error.statusCode = 400;
        reject(error);
      }
    });

    request.on("error", reject);
  });
}

function createToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function generateRoomCode() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = "";
    for (let index = 0; index < 6; index += 1) {
      code += ROOM_CODE_ALPHABET[crypto.randomInt(0, ROOM_CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) {
      return code;
    }
  }
  throw new Error("暂时无法生成房间号，请稍后重试");
}

function getNetworkUrls() {
  const urls = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const network of interfaces || []) {
      if (network.family === "IPv4" && !network.internal) {
        urls.push("http://" + network.address + ":" + PORT);
      }
    }
  }
  return urls;
}

function normalizeWord(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");
}

function extractJsonObject(text) {
  if (typeof text !== "string") {
    throw new Error("AI 返回内容为空");
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("AI 没有返回 JSON");
  }
  return JSON.parse(text.slice(start, end + 1));
}

async function callDeepSeek(messages, options = {}) {
  if (!DEEPSEEK_API_KEY) {
    throw new Error("未配置 DEEPSEEK_API_KEY");
  }

  const response = await fetch(DEEPSEEK_API_URL, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + DEEPSEEK_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages,
      temperature: options.temperature ?? 0.4,
      max_tokens: options.maxTokens ?? 300
    }),
    signal: AbortSignal.timeout(15000)
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new Error("DeepSeek 返回了无法解析的内容");
  }

  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || "DeepSeek 请求失败";
    throw new Error(message);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("DeepSeek 没有返回可用内容");
  }
  return content;
}

function fallbackTheme() {
  const available = FALLBACK_THEMES.filter((theme) =>
    ![...rooms.values()].some((room) => room.theme?.target === theme.target)
  );
  const pool = available.length > 0 ? available : FALLBACK_THEMES;
  const theme = pool[crypto.randomInt(0, pool.length)];
  return {
    ...theme,
    source: "fallback"
  };
}

async function generateTheme() {
  if (!DEEPSEEK_API_KEY) {
    return fallbackTheme();
  }

  try {
    const content = await callDeepSeek([
      {
        role: "system",
        content: "你是中文双人猜词游戏的出题器。只输出合法 JSON，不要使用 Markdown。"
      },
      {
        role: "user",
        content: [
          "随机生成一个适合普通玩家猜测的中文主题词，长度2到5个汉字。",
          "再写一条有画面感但不直接出现主题词、也不同义替换的提示，长度15到45个汉字。",
          "给出一个2到5字的内容类别。避免隐私、品牌、真人、政治、医疗和争议内容。",
          "严格返回：{\"target\":\"主题词\",\"clue\":\"提示\",\"category\":\"类别\"}"
        ].join("\n")
      }
    ], {
      temperature: 0.95,
      maxTokens: 220
    });
    const parsed = extractJsonObject(content);
    const target = normalizeWord(parsed.target);
    const clue = typeof parsed.clue === "string" ? parsed.clue.trim() : "";
    const category = typeof parsed.category === "string" ? parsed.category.trim() : "联想";

    if (!target || [...target].length > 5 || !clue || [...clue].length > 80) {
      throw new Error("AI 生成的主题格式不正确");
    }

    return {
      target,
      clue,
      category: category.slice(0, 10),
      source: "deepseek"
    };
  } catch (error) {
    console.warn("DeepSeek 主题生成失败，使用本地备用主题:", error.message);
    return fallbackTheme();
  }
}

function fallbackCloseness(theme, answerA, answerB) {
  function score(answer) {
    if (answer === theme.target) {
      return 100;
    }
    const targetCharacters = new Set([...theme.target]);
    const clueCharacters = new Set([...theme.clue.replace(/\s+/g, "")]);
    const answerCharacters = [...answer];
    const targetMatches = answerCharacters.filter((character) => targetCharacters.has(character)).length;
    const clueMatches = answerCharacters.filter((character) => clueCharacters.has(character)).length;
    return Math.min(95, 25 + targetMatches * 24 + clueMatches * 4);
  }

  const scores = {
    A: score(answerA),
    B: score(answerB)
  };
  return {
    scores,
    closer: scores.A === scores.B ? "tie" : scores.A > scores.B ? "A" : "B",
    explanation: "AI 暂时不可用，本回合按猜测与提示的关联程度估算。",
    source: "fallback"
  };
}

async function judgeThemeGuesses(theme, answerA, answerB) {
  const exactA = answerA === theme.target;
  const exactB = answerB === theme.target;
  let judgement;

  if (!DEEPSEEK_API_KEY) {
    judgement = fallbackCloseness(theme, answerA, answerB);
  } else {
    try {
      const content = await callDeepSeek([
        {
          role: "system",
          content: "你是严格、简洁的中文语义裁判。只输出合法 JSON，不要使用 Markdown。"
        },
        {
          role: "user",
          content: [
            "目标主题词：" + theme.target,
            "主题提示：" + theme.clue,
            "玩家 A 的猜测：" + answerA,
            "玩家 B 的猜测：" + answerB,
            "判断哪一个猜测在语义上更接近目标主题词。",
            "分数范围0到100，exact视为100。解释不要直接写出目标主题词。",
            "严格返回：{\"scoreA\":数字,\"scoreB\":数字,\"closer\":\"A或B或tie\",\"explanation\":\"30字以内\"}"
          ].join("\n")
        }
      ], {
        temperature: 0.1,
        maxTokens: 180
      });
      const parsed = extractJsonObject(content);
      const scoreA = Number(parsed.scoreA);
      const scoreB = Number(parsed.scoreB);
      if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) {
        throw new Error("AI 评分格式不正确");
      }
      judgement = {
        scores: {
          A: Math.max(0, Math.min(100, Math.round(scoreA))),
          B: Math.max(0, Math.min(100, Math.round(scoreB)))
        },
        closer: parsed.closer === "A" || parsed.closer === "B" || parsed.closer === "tie"
          ? parsed.closer
          : "tie",
        explanation: typeof parsed.explanation === "string"
          ? parsed.explanation.trim().slice(0, 80)
          : "AI 已完成语义比较。",
        source: "deepseek"
      };
    } catch (error) {
      console.warn("DeepSeek 语义评分失败，使用本地估算:", error.message);
      judgement = fallbackCloseness(theme, answerA, answerB);
    }
  }

  if (exactA && !exactB) {
    judgement.scores.A = 100;
    judgement.scores.B = Math.min(99, judgement.scores.B);
    judgement.closer = "A";
  } else if (exactB && !exactA) {
    judgement.scores.B = 100;
    judgement.scores.A = Math.min(99, judgement.scores.A);
    judgement.closer = "B";
  } else if (exactA && exactB) {
    judgement.scores.A = 100;
    judgement.scores.B = 100;
    judgement.closer = "tie";
  }

  return judgement;
}

function archiveMatch(room) {
  if (!room.result || room.currentMatchArchived) {
    return;
  }

  room.currentMatchArchived = true;
  room.matches.unshift({
    id: crypto.randomUUID(),
    number: room.matchNumber,
    mode: room.mode,
    startedAt: room.matchStartedAt,
    endedAt: Date.now(),
    winnerWord: room.mode === "theme" ? room.result.target : room.result.winner,
    winnerPlayer: room.result.winnerPlayer || null,
    rounds: room.history.map((entry) => ({ ...entry })),
    chat: room.chat.map((message) => ({ ...message }))
  });
  room.matches.splice(MAX_MATCH_HISTORY);
}

async function createRoom(mode = "classic") {
  const roomId = generateRoomCode();
  const token = createToken();
  const now = Date.now();
  const roomMode = mode === "theme" ? "theme" : "classic";
  const room = {
    id: roomId,
    createdAt: now,
    updatedAt: now,
    mode: roomMode,
    phase: "waiting",
    round: 1,
    matchNumber: 1,
    matchStartedAt: now,
    currentMatchArchived: false,
    theme: null,
    answers: {
      A: null,
      B: null
    },
    players: {
      A: {
        token,
        joinedAt: now
      },
      B: null
    },
    history: [],
    matches: [],
    result: null,
    chat: [],
    chatTimes: {
      A: [],
      B: []
    }
  };

  if (room.mode === "theme") {
    room.theme = await generateTheme();
  }

  rooms.set(roomId, room);
  return { room, player: "A", token };
}

function findPlayer(room, token) {
  if (!room || typeof token !== "string") {
    return null;
  }
  for (const player of ["A", "B"]) {
    if (room.players[player] && room.players[player].token === token) {
      return player;
    }
  }
  return null;
}

function isPlayerOnline(roomId, player) {
  const roomListeners = roomStreams.get(roomId);
  if (!roomListeners) {
    return false;
  }
  for (const listener of roomListeners) {
    if (listener.player === player) {
      return true;
    }
  }
  return false;
}

function publicMatchSummary(match) {
  return {
    id: match.id,
    number: match.number,
    mode: match.mode,
    startedAt: match.startedAt,
    endedAt: match.endedAt,
    roundCount: match.rounds.length,
    winnerWord: match.winnerWord || null,
    winnerPlayer: match.winnerPlayer || null
  };
}

function publicState(room) {
  return {
    ok: true,
    roomId: room.id,
    mode: room.mode,
    phase: room.phase,
    round: room.round,
    matchNumber: room.matchNumber,
    completed: room.history.length,
    players: {
      A: {
        joined: Boolean(room.players.A),
        online: isPlayerOnline(room.id, "A"),
        submitted: Boolean(room.answers.A)
      },
      B: {
        joined: Boolean(room.players.B),
        online: isPlayerOnline(room.id, "B"),
        submitted: Boolean(room.answers.B)
      }
    },
    result: room.result,
    history: room.history,
    chat: room.chat,
    matches: room.matches.map(publicMatchSummary),
    theme: room.mode === "theme" && room.theme
      ? {
          category: room.theme.category,
          clue: room.theme.clue,
          source: room.theme.source,
          target: room.phase === "won" ? room.theme.target : null
        }
      : null
  };
}

const roomStreams = new Map();

function broadcastState(room) {
  const listeners = roomStreams.get(room.id);
  if (!listeners || listeners.size === 0) {
    return;
  }

  const payload = "event: state\ndata: " + JSON.stringify(publicState(room)) + "\n\n";
  for (const listener of listeners) {
    try {
      listener.response.write(payload);
    } catch {
      listeners.delete(listener);
    }
  }
}

function writeGlobalChat(response, payload) {
  response.write("event: global-chat\ndata: " + JSON.stringify(payload) + "\n\n");
}

function broadcastGlobalChat(message) {
  for (const listeners of roomStreams.values()) {
    for (const listener of listeners) {
      try {
        writeGlobalChat(listener.response, {
          type: "message",
          message
        });
      } catch {
        // 断开的连接会由房间事件流清理。
      }
    }
  }
}

function openEventStream(request, response, room, player) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  response.write("retry: 2500\n\n");

  const listener = {
    response,
    player
  };
  let listeners = roomStreams.get(room.id);
  if (!listeners) {
    listeners = new Set();
    roomStreams.set(room.id, listeners);
  }
  listeners.add(listener);

  const payload = "event: state\ndata: " + JSON.stringify(publicState(room)) + "\n\n";
  response.write(payload);
  writeGlobalChat(response, {
    type: "snapshot",
    messages: globalChat
  });
  broadcastState(room);

  const heartbeat = setInterval(() => {
    try {
      response.write(": keep-alive\n\n");
    } catch {
      cleanup();
    }
  }, 20000);

  function cleanup() {
    clearInterval(heartbeat);
    const currentListeners = roomStreams.get(room.id);
    if (currentListeners) {
      currentListeners.delete(listener);
      if (currentListeners.size === 0) {
        roomStreams.delete(room.id);
      }
    }
    broadcastState(room);
  }

  request.on("close", cleanup);
  response.on("error", cleanup);
}

function getRoom(requestUrl) {
  return rooms.get(requestUrl.pathname.split("/")[3] || "");
}

async function handleApi(request, response, requestUrl) {
  if (request.method === "GET" && requestUrl.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      rooms: rooms.size,
      uptime: Math.round(process.uptime()),
      networkUrls: getNetworkUrls(),
      ai: {
        provider: "deepseek",
        configured: Boolean(DEEPSEEK_API_KEY),
        model: DEEPSEEK_MODEL
      }
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/rooms") {
    const body = await readJson(request);
    const created = await createRoom(body.mode);
    broadcastState(created.room);
    sendJson(response, 201, {
      ok: true,
      roomId: created.room.id,
      player: created.player,
      token: created.token,
      state: publicState(created.room)
    });
    return;
  }

  const roomMatch = requestUrl.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})(?:\/(join|answers|chat|global-chat|match|next|restart|events))?$/);
  if (!roomMatch) {
    sendError(response, 404, "接口不存在", "NOT_FOUND");
    return;
  }

  const roomId = roomMatch[1];
  const action = roomMatch[2] || "state";
  const room = rooms.get(roomId);

  if (!room) {
    sendError(response, 404, "房间不存在，可能已经过期", "ROOM_NOT_FOUND");
    return;
  }

  room.updatedAt = Date.now();

  if (request.method === "POST" && action === "join") {
    if (room.players.B) {
      sendError(response, 409, "这个房间已经有两位玩家了", "ROOM_FULL");
      return;
    }

    const token = createToken();
    room.players.B = {
      token,
      joinedAt: Date.now()
    };
    room.phase = "playing";
    room.updatedAt = Date.now();
    broadcastState(room);
    sendJson(response, 200, {
      ok: true,
      roomId: room.id,
      player: "B",
      token,
      state: publicState(room)
    });
    return;
  }

  const body = request.method === "POST" ? await readJson(request) : {};
  const token = request.method === "GET"
    ? requestUrl.searchParams.get("token")
    : body.token;
  const player = findPlayer(room, token);

  if (!player) {
    sendError(response, 401, "玩家身份已失效，请重新加入房间", "INVALID_SESSION");
    return;
  }

  if (request.method === "GET" && action === "state") {
    sendJson(response, 200, publicState(room));
    return;
  }

  if (request.method === "GET" && action === "events") {
    openEventStream(request, response, room, player);
    return;
  }

  if (request.method === "GET" && action === "match") {
    const matchId = requestUrl.searchParams.get("matchId");
    const match = room.matches.find((entry) => entry.id === matchId);
    if (!match) {
      sendError(response, 404, "没有找到这场对局", "MATCH_NOT_FOUND");
      return;
    }
    sendJson(response, 200, {
      ok: true,
      match
    });
    return;
  }

  if (request.method !== "POST") {
    sendError(response, 405, "不支持这个请求方式", "METHOD_NOT_ALLOWED");
    return;
  }

  if (action === "answers") {
    if (!room.players.B) {
      sendError(response, 409, "还在等待另一位玩家加入", "WAITING_FOR_PLAYER");
      return;
    }

    if (room.phase !== "playing") {
      sendError(response, 409, "本回合已经结束", "ROUND_CLOSED");
      return;
    }

    if (room.answers[player]) {
      sendError(response, 409, "你已经提交过本回合的答案", "ALREADY_SUBMITTED");
      return;
    }

    const answer = normalizeWord(body.word);
    if (!answer) {
      sendError(response, 400, "请输入一个词", "EMPTY_WORD");
      return;
    }
    if ([...answer].length > 20) {
      sendError(response, 400, "词语不能超过 20 个字符", "WORD_TOO_LONG");
      return;
    }

    room.answers[player] = answer;
    room.updatedAt = Date.now();

    if (room.answers.A && room.answers.B) {
      const answers = {
        A: room.answers.A,
        B: room.answers.B
      };

      if (room.mode === "theme") {
        room.phase = "judging";
        broadcastState(room);

        const judgement = await judgeThemeGuesses(room.theme, answers.A, answers.B);
        const exactA = answers.A === room.theme.target;
        const exactB = answers.B === room.theme.target;
        const hit = exactA || exactB;
        const winnerPlayer = hit
          ? exactA && exactB
            ? null
            : exactA
              ? "A"
              : "B"
          : null;
        const explanation = judgement.explanation.replaceAll(room.theme.target, "主题词");

        room.result = hit
          ? {
              round: room.round,
              answers,
              isMatch: true,
              mode: "theme",
              target: room.theme.target,
              winner: room.theme.target,
              winnerPlayer,
              closer: judgement.closer,
              scores: judgement.scores,
              explanation: winnerPlayer
                ? "玩家 " + winnerPlayer + " 猜中了隐藏主题词，并按语义接近度获胜。"
                : "双方同时猜中隐藏主题词，本局平局。",
              judgementSource: judgement.source
            }
          : {
              round: room.round,
              answers,
              isMatch: false,
              mode: "theme",
              winner: null,
              winnerPlayer: null,
              closer: judgement.closer,
              explanation,
              judgementSource: judgement.source
            };

        room.history.push(room.result);
        room.phase = hit ? "won" : "resolved";
        if (hit) {
          archiveMatch(room);
        }
      } else {
        const isMatch = answers.A === answers.B;
        room.result = {
          round: room.round,
          answers,
          isMatch,
          mode: "classic",
          winner: isMatch ? answers.A : null
        };
        room.history.push(room.result);
        room.phase = isMatch ? "won" : "resolved";
        if (isMatch) {
          archiveMatch(room);
        }
      }
    }

    broadcastState(room);
    sendJson(response, 200, publicState(room));
    return;
  }

  if (action === "chat") {
    const text = typeof body.text === "string"
      ? body.text.trim().replace(/\s+/g, " ")
      : "";

    if (!text) {
      sendError(response, 400, "请输入聊天内容", "EMPTY_CHAT");
      return;
    }
    if ([...text].length > 200) {
      sendError(response, 400, "聊天内容不能超过 200 个字符", "CHAT_TOO_LONG");
      return;
    }

    const now = Date.now();
    room.chatTimes[player] = room.chatTimes[player].filter((time) => now - time < 5000);
    if (room.chatTimes[player].length >= 5) {
      sendError(response, 429, "消息发得太快了，请稍等几秒", "CHAT_RATE_LIMIT");
      return;
    }
    room.chatTimes[player].push(now);
    room.chat.push({
      id: crypto.randomUUID(),
      player,
      text,
      time: now
    });
    if (room.chat.length > 50) {
      room.chat.splice(0, room.chat.length - 50);
    }

    room.updatedAt = now;
    broadcastState(room);
    sendJson(response, 200, publicState(room));
    return;
  }

  if (action === "global-chat") {
    const text = typeof body.text === "string"
      ? body.text.trim().replace(/\s+/g, " ")
      : "";

    if (!text) {
      sendError(response, 400, "请输入聊天内容", "EMPTY_CHAT");
      return;
    }
    if ([...text].length > 200) {
      sendError(response, 400, "聊天内容不能超过 200 个字符", "CHAT_TOO_LONG");
      return;
    }

    const now = Date.now();
    const recentTimes = (globalChatTimes.get(token) || []).filter((time) => now - time < 5000);
    if (recentTimes.length >= 5) {
      sendError(response, 429, "消息发得太快了，请稍等几秒", "CHAT_RATE_LIMIT");
      return;
    }
    recentTimes.push(now);
    globalChatTimes.set(token, recentTimes);

    if (globalChatTimes.size > 500) {
      for (const [storedToken, times] of globalChatTimes) {
        if (times.every((time) => now - time >= 5000)) {
          globalChatTimes.delete(storedToken);
        }
      }
    }

    const message = {
      id: crypto.randomUUID(),
      roomId: room.id,
      player,
      text,
      time: now
    };
    globalChat.push(message);
    if (globalChat.length > MAX_GLOBAL_CHAT_MESSAGES) {
      globalChat.splice(0, globalChat.length - MAX_GLOBAL_CHAT_MESSAGES);
    }
    broadcastGlobalChat(message);
    sendJson(response, 200, {
      ok: true,
      message
    });
    return;
  }

  if (action === "next") {
    if (room.phase !== "resolved") {
      sendError(response, 409, "当前不能进入下一回合", "ROUND_NOT_RESOLVED");
      return;
    }

    room.round += 1;
    room.answers = {
      A: null,
      B: null
    };
    room.result = null;
    room.phase = "playing";
    room.updatedAt = Date.now();
    broadcastState(room);
    sendJson(response, 200, publicState(room));
    return;
  }

  if (action === "restart") {
    if (room.phase !== "won") {
      sendError(response, 409, "这一局还没有结束", "GAME_NOT_FINISHED");
      return;
    }

    const nextTheme = room.mode === "theme" ? await generateTheme() : null;
    room.round = 1;
    room.matchNumber += 1;
    room.matchStartedAt = Date.now();
    room.currentMatchArchived = false;
    room.theme = nextTheme;
    room.answers = {
      A: null,
      B: null
    };
    room.history = [];
    room.chat = [];
    room.chatTimes = {
      A: [],
      B: []
    };
    room.result = null;
    room.phase = "playing";
    room.updatedAt = Date.now();
    broadcastState(room);
    sendJson(response, 200, publicState(room));
    return;
  }

  sendError(response, 404, "接口不存在", "NOT_FOUND");
}

function serveStatic(request, response, requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    sendError(response, 400, "路径格式不正确", "INVALID_PATH");
    return;
  }

  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(PUBLIC_DIR, relativePath);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    sendError(response, 403, "禁止访问", "FORBIDDEN");
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      sendError(response, 404, "页面不存在", "NOT_FOUND");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      "Content-Length": stats.size,
      "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=300"
    });
    fs.createReadStream(filePath).pipe(response);
  });
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, "http://localhost");

  try {
    if (requestUrl.pathname.startsWith("/api/")) {
      await handleApi(request, response, requestUrl);
    } else if (request.method === "GET" || request.method === "HEAD") {
      serveStatic(request, response, requestUrl);
    } else {
      sendError(response, 405, "不支持这个请求方式", "METHOD_NOT_ALLOWED");
    }
  } catch (error) {
    if (!response.headersSent) {
      sendError(
        response,
        error.statusCode || 500,
        error.statusCode ? error.message : "服务器开小差了，请稍后重试",
        error.statusCode ? "BAD_REQUEST" : "SERVER_ERROR"
      );
    } else {
      response.end();
    }
    if (!error.statusCode) {
      console.error(error);
    }
  }
});

function cleanupRooms() {
  const cutoff = Date.now() - ROOM_LIFETIME_MS;
  for (const [roomId, room] of rooms) {
    if (room.updatedAt < cutoff && !roomStreams.has(roomId)) {
      rooms.delete(roomId);
    }
  }
}

setInterval(cleanupRooms, 30 * 60 * 1000).unref();

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("撞词计划 · 联网版已启动");
  console.log("本机访问: http://localhost:" + PORT);

  for (const url of getNetworkUrls()) {
    console.log("局域网访问: " + url);
  }

  console.log("");
});

function shutdown() {
  console.log("\n正在关闭服务器…");
  for (const listeners of roomStreams.values()) {
    for (const listener of listeners) {
      listener.response.end();
    }
  }
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
