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

function createRoom() {
  const roomId = generateRoomCode();
  const token = createToken();
  const now = Date.now();
  const room = {
    id: roomId,
    createdAt: now,
    updatedAt: now,
    phase: "waiting",
    round: 1,
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
    result: null,
    chat: [],
    chatTimes: {
      A: [],
      B: []
    }
  };

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

function publicState(room) {
  return {
    ok: true,
    roomId: room.id,
    phase: room.phase,
    round: room.round,
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
    chat: room.chat
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
      networkUrls: getNetworkUrls()
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/rooms") {
    const created = createRoom();
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

  const roomMatch = requestUrl.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})(?:\/(join|answers|chat|next|restart|events))?$/);
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
      const isMatch = room.answers.A === room.answers.B;
      room.result = {
        round: room.round,
        answers: {
          A: room.answers.A,
          B: room.answers.B
        },
        isMatch,
        winner: isMatch ? room.answers.A : null
      };
      room.history.push(room.result);
      room.phase = isMatch ? "won" : "resolved";
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

    room.round = 1;
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
