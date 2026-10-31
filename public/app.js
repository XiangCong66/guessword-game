(() => {
  "use strict";

  const SESSION_KEY = "friendword-online-session-v1";
  const PLAYERS = ["A", "B"];
  const playerIndex = {
    A: 0,
    B: 1
  };

  const elements = {
    serverState: document.getElementById("serverState"),
    lobbyScreen: document.getElementById("lobbyScreen"),
    gameScreen: document.getElementById("gameScreen"),
    createRoomButton: document.getElementById("createRoomButton"),
    gameModeInputs: document.querySelectorAll('input[name="gameMode"]'),
    aiModeHint: document.getElementById("aiModeHint"),
    joinForm: document.getElementById("joinForm"),
    roomCodeInput: document.getElementById("roomCodeInput"),
    joinRoomButton: document.getElementById("joinRoomButton"),
    lobbyMessage: document.getElementById("lobbyMessage"),
    playerLabel: document.getElementById("playerLabel"),
    roundNumber: document.getElementById("roundNumber"),
    roomCode: document.getElementById("roomCode"),
    copyInviteButton: document.getElementById("copyInviteButton"),
    themeCard: document.getElementById("themeCard"),
    themeCategory: document.getElementById("themeCategory"),
    themeClueTitle: document.getElementById("themeClueTitle"),
    themeSource: document.getElementById("themeSource"),
    themeHelp: document.getElementById("themeHelp"),
    completedRounds: document.getElementById("completedRounds"),
    statusText: document.getElementById("statusText"),
    statusDot: document.getElementById("statusDot"),
    connectionLabel: document.getElementById("connectionLabel"),
    playerCards: [
      document.getElementById("playerCardA"),
      document.getElementById("playerCardB")
    ],
    playerNotes: [
      document.getElementById("playerNoteA"),
      document.getElementById("playerNoteB")
    ],
    presences: [
      document.getElementById("presenceA"),
      document.getElementById("presenceB")
    ],
    forms: [
      document.getElementById("formA"),
      document.getElementById("formB")
    ],
    inputs: [
      document.getElementById("answerA"),
      document.getElementById("answerB")
    ],
    answerLabels: [
      document.getElementById("answerLabelA"),
      document.getElementById("answerLabelB")
    ],
    wordStates: [
      document.getElementById("wordStateA"),
      document.getElementById("wordStateB")
    ],
    submitButtons: [
      document.getElementById("submitA"),
      document.getElementById("submitB")
    ],
    chatMessages: document.getElementById("chatMessages"),
    chatForm: document.getElementById("chatForm"),
    chatInput: document.getElementById("chatInput"),
    chatSendButton: document.getElementById("chatSendButton"),
    chatStatus: document.getElementById("chatStatus"),
    roomChatTab: document.getElementById("roomChatTab"),
    globalChatTab: document.getElementById("globalChatTab"),
    historyList: document.getElementById("historyList"),
    matchesList: document.getElementById("matchesList"),
    currentMatchTab: document.getElementById("currentMatchTab"),
    pastMatchTab: document.getElementById("pastMatchTab"),
    pastMatchCount: document.getElementById("pastMatchCount"),
    roundDialog: document.getElementById("roundDialog"),
    roundDialogKicker: document.getElementById("roundDialogKicker"),
    roundDialogTitle: document.getElementById("roundDialogTitle"),
    roundDialogDescription: document.getElementById("roundDialogDescription"),
    resultWordA: document.getElementById("resultWordA"),
    resultWordB: document.getElementById("resultWordB"),
    roundFeedback: document.getElementById("roundFeedback"),
    nextRoundButton: document.getElementById("nextRoundButton"),
    winDialog: document.getElementById("winDialog"),
    winDialogKicker: document.getElementById("winDialogKicker"),
    winDialogTitle: document.getElementById("winDialogTitle"),
    winWord: document.getElementById("winWord"),
    winDialogDescription: document.getElementById("winDialogDescription"),
    winVerdict: document.getElementById("winVerdict"),
    viewWinMatchButton: document.getElementById("viewWinMatchButton"),
    playAgainButton: document.getElementById("playAgainButton"),
    matchDialog: document.getElementById("matchDialog"),
    matchDialogKicker: document.getElementById("matchDialogKicker"),
    matchDialogTitle: document.getElementById("matchDialogTitle"),
    matchDialogDescription: document.getElementById("matchDialogDescription"),
    matchRounds: document.getElementById("matchRounds"),
    matchChatDetails: document.getElementById("matchChatDetails"),
    matchChatList: document.getElementById("matchChatList"),
    closeMatchDialogButton: document.getElementById("closeMatchDialogButton"),
    closeMatchDialogFooter: document.getElementById("closeMatchDialogFooter"),
    toast: document.getElementById("toast"),
    confettiLayer: document.getElementById("confettiLayer")
  };

  const app = {
    session: null,
    room: null,
    eventSource: null,
    networkUrls: [],
    toastTimer: null,
    submitting: false,
    sendingChat: false,
    celebratedRound: null,
    dismissedWinMatchNumber: null,
    lastRound: null,
    lastPhase: null,
    chatChannel: "room",
    globalChat: [],
    chatKeys: {
      room: "",
      global: ""
    },
    chatInitialized: {
      room: false,
      global: false
    },
    historyTab: "current"
  };

  function normalizeCode(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
  }

  function readSession() {
    try {
      const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (
        saved &&
        typeof saved.roomId === "string" &&
        typeof saved.token === "string" &&
        (saved.player === "A" || saved.player === "B")
      ) {
        return saved;
      }
    } catch {
      // 损坏的本地会话直接忽略。
    }
    return null;
  }

  function writeSession(session) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      // 浏览器禁用本地存储时，当前页面仍然可以正常游戏。
    }
  }

  function clearSession() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // 忽略存储权限错误。
    }
  }

  async function request(path, options = {}) {
    const requestOptions = {
      method: options.method || "GET",
      headers: {
        "Accept": "application/json"
      }
    };

    if (options.body !== undefined) {
      requestOptions.headers["Content-Type"] = "application/json";
      requestOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(path, requestOptions);
    let payload = null;

    try {
      payload = await response.json();
    } catch {
      throw new Error("服务器返回了无法识别的内容");
    }

    if (!response.ok) {
      const error = new Error(payload.error || "请求失败，请稍后重试");
      error.status = response.status;
      error.code = payload.code;
      throw error;
    }

    return payload;
  }

  function setServerConnection(mode, message) {
    elements.serverState.classList.toggle("is-online", mode === "online");
    elements.serverState.classList.toggle("is-offline", mode === "offline");
    elements.serverState.lastElementChild.textContent = message;

    elements.connectionLabel.classList.toggle("is-online", mode === "online");
    elements.connectionLabel.classList.toggle("is-offline", mode === "offline");
    elements.connectionLabel.lastChild.textContent = mode === "online" ? " 实时连接" : " 正在重连";
  }

  function setLobbyMessage(message, isError = true) {
    elements.lobbyMessage.textContent = message;
    elements.lobbyMessage.style.color = isError ? "" : "#176f66";
  }

  function showToast(message) {
    window.clearTimeout(app.toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    app.toastTimer = window.setTimeout(() => {
      elements.toast.classList.remove("is-visible");
    }, 2400);
  }

  function setButtonBusy(button, busy, busyText) {
    if (!button.dataset.defaultLabel) {
      button.dataset.defaultLabel = button.textContent.trim();
    }
    button.disabled = busy;
    const textNode = button.querySelector("span");
    if (textNode) {
      textNode.textContent = busy ? busyText : button.dataset.defaultLabel;
    } else {
      button.textContent = busy ? busyText : button.dataset.defaultLabel;
    }
  }

  async function loadHealth() {
    try {
      const health = await request("/api/health");
      app.networkUrls = Array.isArray(health.networkUrls) ? health.networkUrls : [];
      if (health.ai?.provider === "deepseek") {
        elements.aiModeHint.textContent = health.ai.configured
          ? "DeepSeek 在线出题，同词后依据整局表现评分"
          : "未配置 DeepSeek 密钥，将使用本地备用主题";
      }
      setServerConnection("online", "服务器正常");
    } catch {
      setServerConnection("offline", "服务器未连接");
    }
  }

  function clearConnection() {
    if (app.eventSource) {
      app.eventSource.close();
      app.eventSource = null;
    }
  }

  function connectEvents() {
    clearConnection();
    if (!app.session) {
      return;
    }

    const path =
      "/api/rooms/" +
      encodeURIComponent(app.session.roomId) +
      "/events?token=" +
      encodeURIComponent(app.session.token);

    const source = new EventSource(path);
    app.eventSource = source;

    source.onopen = () => {
      setServerConnection("online", "服务器正常");
    };

    source.onerror = () => {
      setServerConnection("offline", "连接中断");
    };

    source.addEventListener("state", (event) => {
      try {
        applyState(JSON.parse(event.data));
      } catch {
        showToast("同步数据时出现了一个小问题");
      }
    });

    source.addEventListener("global-chat", (event) => {
      try {
        handleGlobalChatEvent(JSON.parse(event.data));
      } catch {
        showToast("全局聊天同步时出现了一个小问题");
      }
    });
  }

  function enterRoom(roomState, nextSession) {
    app.session = nextSession;
    app.chatChannel = "room";
    app.globalChat = [];
    app.chatInitialized = {
      room: false,
      global: false
    };
    app.chatKeys = {
      room: "",
      global: ""
    };
    app.dismissedWinMatchNumber = null;
    writeSession(nextSession);
    elements.lobbyScreen.hidden = true;
    elements.gameScreen.hidden = false;
    document.title = "房间 " + nextSession.roomId + " · 撞词计划";

    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("room", nextSession.roomId);
    window.history.replaceState({}, "", url);

    applyState(roomState);
    connectEvents();
  }

  async function restoreSession(saved) {
    try {
      const roomState = await request(
        "/api/rooms/" +
          encodeURIComponent(saved.roomId) +
          "?token=" +
          encodeURIComponent(saved.token)
      );
      enterRoom(roomState, saved);
      return true;
    } catch (error) {
      if (error.status === 401 || error.status === 404) {
        clearSession();
      }
      return false;
    }
  }

  async function createRoom() {
    const mode = document.querySelector('input[name="gameMode"]:checked')?.value || "classic";
    setButtonBusy(
      elements.createRoomButton,
      true,
      mode === "theme" ? "DeepSeek 正在出题…" : "正在创建…"
    );
    setLobbyMessage("");

    try {
      const payload = await request("/api/rooms", {
        method: "POST",
        body: {
          mode
        }
      });
      const session = {
        roomId: payload.roomId,
        token: payload.token,
        player: payload.player
      };
      enterRoom(payload.state, session);
      showToast("房间已创建，把邀请链接发给朋友");
    } catch (error) {
      setLobbyMessage(error.message);
    } finally {
      setButtonBusy(elements.createRoomButton, false, "");
    }
  }

  async function joinRoom() {
    const roomId = normalizeCode(elements.roomCodeInput.value);
    elements.roomCodeInput.value = roomId;
    elements.roomCodeInput.classList.remove("has-error");

    if (roomId.length !== 6) {
      elements.roomCodeInput.classList.add("has-error");
      setLobbyMessage("请输入完整的六位房间号");
      elements.roomCodeInput.focus();
      return;
    }

    setButtonBusy(elements.joinRoomButton, true, "加入中…");
    setLobbyMessage("");

    try {
      const payload = await request("/api/rooms/" + encodeURIComponent(roomId) + "/join", {
        method: "POST"
      });
      const session = {
        roomId: payload.roomId,
        token: payload.token,
        player: payload.player
      };
      enterRoom(payload.state, session);
      showToast("已加入房间，等你们一起想词");
    } catch (error) {
      elements.roomCodeInput.classList.add("has-error");
      setLobbyMessage(error.message);
    } finally {
      setButtonBusy(elements.joinRoomButton, false, "");
    }
  }

  function statusMessage(roomState) {
    const playerA = roomState.players.A;
    const playerB = roomState.players.B;

    if (roomState.phase === "waiting") {
      return roomState.mode === "theme"
        ? "主题已准备好，正在等待朋友加入"
        : "房间已创建，正在等待朋友加入";
    }

    if (roomState.phase === "won") {
      if (roomState.mode === "theme" && roomState.result) {
        if (!roomState.result.winnerPlayer) {
          return "双方说出同一个词，整局评分相同";
        }
        return "双方成功同词，玩家 " + roomState.result.winnerPlayer + " 综合评分获胜";
      }
      return "撞词成功，这一局默契通关";
    }

    if (roomState.phase === "judging") {
      return "双方已经同词，DeepSeek 正在回看整局所有词语并评分";
    }

    if (roomState.phase === "resolved") {
      if (roomState.mode === "theme" && roomState.result) {
        return "还没有说出同一个词，继续围绕主题联想";
      }
      return "答案已揭晓，看看你们是否想到了一起";
    }

    if ((playerA.joined && !playerA.online) || (playerB.joined && !playerB.online)) {
      const offlinePlayer = playerA.joined && !playerA.online ? "玩家 A" : "玩家 B";
      return offlinePlayer + " 暂时离线，连接恢复后可以继续";
    }

    if (playerA.submitted && !playerB.submitted) {
      return "玩家 A 已封存答案，等待玩家 B";
    }

    if (playerB.submitted && !playerA.submitted) {
      return "玩家 B 已封存答案，等待玩家 A";
    }

    return roomState.mode === "theme"
      ? "第 " + roomState.round + " 回合，围绕主题各猜一个词"
      : "第 " + roomState.round + " 回合，等你们各写下一个词";
  }

  function renderTheme(roomState) {
    const isTheme = roomState.mode === "theme" && roomState.theme;
    elements.themeCard.hidden = !isTheme;
    if (!isTheme) {
      return;
    }

    elements.themeCategory.textContent = roomState.theme.category || "主题";
    elements.themeClueTitle.textContent = roomState.theme.theme;

    if (roomState.theme.source === "deepseek") {
      elements.themeSource.textContent = "DeepSeek 主题";
      elements.themeHelp.textContent = "围绕主题持续猜词，直到双方说出同一个词；随后 DeepSeek 会回看整局所有词语评分。";
    } else {
      elements.themeSource.textContent = "备用主题";
      elements.themeHelp.textContent = "DeepSeek 暂未连接。先围绕主题猜词，双方同词后仍会按整局词语估算分数。";
    }
  }

  function renderPlayers(roomState) {
    const isTheme = roomState.mode === "theme";
    const canPlay = roomState.phase === "playing" && roomState.players.A.joined && roomState.players.B.joined;
    const roundChanged = app.lastRound !== roomState.round;
    const phaseChanged = app.lastPhase !== roomState.phase;
    const shouldClear = roundChanged || phaseChanged;

    PLAYERS.forEach((player) => {
      const index = playerIndex[player];
      const playerState = roomState.players[player];
      const isOwn = app.session && app.session.player === player;
      const isSubmitted = playerState.submitted;
      const enabled = Boolean(canPlay && isOwn && !isSubmitted);
      const input = elements.inputs[index];
      const button = elements.submitButtons[index];

      elements.playerCards[index].classList.toggle("is-own", Boolean(isOwn));
      elements.answerLabels[index].textContent = isOwn
        ? isTheme ? "你的猜测" : "你的词"
        : "玩家 " + player + (isTheme ? " 的猜测" : " 的词");

      if (!playerState.joined) {
        elements.playerNotes[index].textContent = "正在等待加入";
        elements.presences[index].textContent = "未加入";
        elements.presences[index].classList.remove("is-online");
      } else {
        elements.playerNotes[index].textContent = playerState.online
          ? isOwn
            ? "这是你的输入区"
            : "在同一房间实时同步"
          : "暂时离线，等待重连";
        elements.presences[index].textContent = playerState.online ? "在线" : "离线";
        elements.presences[index].classList.toggle("is-online", playerState.online);
      }

      if (shouldClear) {
        input.value = "";
        input.classList.remove("has-error");
      }

      input.disabled = !enabled;
      button.disabled = !enabled;
      input.type = isSubmitted ? "password" : "text";

      if (isSubmitted) {
        input.value = "";
        input.placeholder = "答案已封存";
        elements.wordStates[index].textContent = "已封存";
      } else if (!playerState.joined) {
        input.placeholder = "等待玩家加入";
        elements.wordStates[index].textContent = "等待中";
      } else if (!isOwn) {
        input.placeholder = playerState.online
          ? isTheme ? "对方正在猜" : "对方正在想词"
          : "对方暂时离线";
        elements.wordStates[index].textContent = "实时同步";
      } else if (!canPlay) {
        input.placeholder = "本回合暂不可输入";
        elements.wordStates[index].textContent = "等待揭晓";
      } else {
        input.placeholder = isTheme ? "写下你的猜测" : "写下一个词";
        elements.wordStates[index].textContent = "等待你写";
      }

      const buttonLabel = button.querySelector("span");
      if (buttonLabel) {
        buttonLabel.textContent = isSubmitted
          ? "已提交，等待揭晓"
          : isTheme ? "提交猜测" : "提交这个词";
      }
    });

    if (shouldClear && canPlay) {
      const ownIndex = app.session ? playerIndex[app.session.player] : 0;
      window.setTimeout(() => {
        if (!elements.inputs[ownIndex].disabled) {
          elements.inputs[ownIndex].focus();
        }
      }, 80);
    }
  }

  function renderHistory(history) {
    elements.historyList.replaceChildren();

    if (!history || history.length === 0) {
      const empty = document.createElement("span");
      empty.className = "history-empty";
      empty.textContent = "还没有揭晓记录。";
      elements.historyList.appendChild(empty);
      return;
    }

    history.forEach((entry) => {
      const chip = document.createElement("span");
      const round = document.createElement("small");
      const wordA = document.createElement("strong");
      const separator = document.createElement("span");
      const wordB = document.createElement("strong");

      chip.className = "history-chip" +
        (entry.isMatch ? " is-match" : "") +
        (entry.mode === "theme" ? " is-theme" : "");
      round.textContent = "R" + String(entry.round).padStart(2, "0");
      wordA.textContent = entry.answers.A;
      separator.textContent = entry.isMatch ? "＝" : "↔";
      wordB.textContent = entry.answers.B;
      chip.append(round, wordA, separator, wordB);
      if (entry.mode === "theme" && entry.isMatch && entry.scores) {
        const score = document.createElement("small");
        score.className = "history-target";
        score.textContent = "整局 A " + entry.scores.A + " · B " + entry.scores.B;
        chip.appendChild(score);
      }
      elements.historyList.appendChild(chip);
    });
  }

  function formatMatchDate(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  }

  function matchResultText(match) {
    if (match.mode === "theme") {
      if (match.winnerPlayer) {
        return "玩家 " + match.winnerPlayer + " 获胜";
      }
      return "平局";
    }
    return "默契通关";
  }

  function renderMatches(matches) {
    const entries = Array.isArray(matches) ? matches : [];
    elements.matchesList.replaceChildren();
    elements.pastMatchCount.textContent = String(entries.length);

    if (entries.length === 0) {
      const empty = document.createElement("span");
      empty.className = "history-empty";
      empty.textContent = "完成一局后，可以在这里回看过程。";
      elements.matchesList.appendChild(empty);
      return;
    }

    entries.forEach((match) => {
      const card = document.createElement("article");
      const info = document.createElement("div");
      const title = document.createElement("strong");
      const meta = document.createElement("span");
      const badge = document.createElement("span");
      const button = document.createElement("button");

      card.className = "match-card";
      title.textContent = "第 " + match.number + " 局 · " + matchResultText(match);
      meta.textContent =
        formatMatchDate(match.endedAt) +
        " · " +
        match.roundCount +
        " 回合 · " +
        (match.winnerWord || "未记录");
      badge.textContent = match.mode === "theme" ? "AI 主题" : "默契同词";
      button.type = "button";
      button.textContent = "查看过程";
      button.addEventListener("click", () => openMatch(match.id));
      info.append(title, meta);
      card.append(info, badge, button);
      elements.matchesList.appendChild(card);
    });
  }

  function setHistoryTab(tab) {
    app.historyTab = tab === "past" ? "past" : "current";
    const showPast = app.historyTab === "past";
    elements.currentMatchTab.setAttribute("aria-selected", String(!showPast));
    elements.pastMatchTab.setAttribute("aria-selected", String(showPast));
    elements.currentMatchTab.classList.toggle("is-active", !showPast);
    elements.pastMatchTab.classList.toggle("is-active", showPast);
    elements.historyList.hidden = showPast;
    elements.matchesList.hidden = !showPast;
  }

  function formatChatTime(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  }

  function renderChat(messages, channel = app.chatChannel) {
    const chatMessages = Array.isArray(messages) ? messages : [];
    const chatKey = channel + ":" + chatMessages.map((message) => message.id).join("|");
    if (
      app.chatInitialized[channel] &&
      app.chatKeys[channel] === chatKey
    ) {
      return;
    }

    const wasNearBottom = !app.chatInitialized[channel] ||
      elements.chatMessages.scrollHeight - elements.chatMessages.scrollTop - elements.chatMessages.clientHeight < 48;
    elements.chatMessages.replaceChildren();

    if (chatMessages.length === 0) {
      const empty = document.createElement("p");
      empty.className = "chat-empty";
      empty.textContent = channel === "global"
        ? "全局频道还没有消息，和所有在线玩家打个招呼吧。"
        : "还没有消息，和房间里的朋友打个招呼吧。";
      elements.chatMessages.appendChild(empty);
    } else {
      chatMessages.forEach((message) => {
        const item = document.createElement("article");
        const avatar = document.createElement("span");
        const content = document.createElement("div");
        const meta = document.createElement("div");
        const player = document.createElement("strong");
        const time = document.createElement("time");
        const text = document.createElement("p");
        const isOwn = app.session && app.session.player === message.player;

        item.className = "chat-message" + (isOwn ? " is-own" : "");
        avatar.className = "chat-avatar";
        avatar.textContent = message.player;
        content.className = "chat-message-content";
        meta.className = "chat-message-meta";
        player.textContent = "玩家 " + message.player;
        if (channel === "global" && message.roomId) {
          player.textContent += " · 房间 " + message.roomId;
        }
        time.dateTime = new Date(message.time).toISOString();
        time.textContent = formatChatTime(message.time);
        text.textContent = message.text;
        meta.append(player, time);
        content.append(meta, text);
        item.append(avatar, content);
        elements.chatMessages.appendChild(item);
      });
    }

    if (wasNearBottom) {
      elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    }
    app.chatKeys[channel] = chatKey;
    app.chatInitialized[channel] = true;
  }

  function renderChatControls(roomState) {
    const canChat = Boolean(
      app.session &&
      roomState &&
      roomState.players[app.session.player]?.joined
    );
    elements.chatInput.disabled = !canChat || app.sendingChat;
    elements.chatSendButton.disabled = !canChat || app.sendingChat;
    elements.chatInput.placeholder = app.chatChannel === "global"
      ? "对所有在线玩家说点什么…"
      : "和房间里的朋友说点什么…";

    if (!canChat) {
      elements.chatStatus.textContent = "连接房间后可以发送消息";
    } else if (app.chatChannel === "global") {
      elements.chatStatus.textContent = "按回车发送 · 会显示给所有在线玩家";
    } else if (!roomState.players.B?.joined) {
      elements.chatStatus.textContent = "朋友加入后，消息会在同一房间同步";
    } else {
      elements.chatStatus.textContent = "按回车发送 · 仅本房间可见";
    }
  }

  function activeChatMessages() {
    return app.chatChannel === "global"
      ? app.globalChat
      : (app.room?.chat || []);
  }

  function renderActiveChat() {
    renderChat(activeChatMessages(), app.chatChannel);
  }

  function handleGlobalChatEvent(payload) {
    if (payload?.type === "snapshot") {
      app.globalChat = Array.isArray(payload.messages) ? payload.messages : [];
    } else if (payload?.type === "message" && payload.message) {
      if (!app.globalChat.some((message) => message.id === payload.message.id)) {
        app.globalChat.push(payload.message);
      }
      if (app.globalChat.length > 100) {
        app.globalChat.splice(0, app.globalChat.length - 100);
      }
    }

    if (app.chatChannel === "global") {
      renderChat(app.globalChat, "global");
    }
  }

  function setChatChannel(channel) {
    app.chatChannel = channel === "global" ? "global" : "room";
    const isGlobal = app.chatChannel === "global";
    elements.roomChatTab.setAttribute("aria-selected", String(!isGlobal));
    elements.globalChatTab.setAttribute("aria-selected", String(isGlobal));
    elements.roomChatTab.classList.toggle("is-active", !isGlobal);
    elements.globalChatTab.classList.toggle("is-active", isGlobal);
    elements.roomChatTab.parentElement.parentElement.querySelector(".section-kicker").textContent =
      isGlobal ? "GLOBAL CHAT" : "ROOM CHAT";
    document.getElementById("chatTitle").textContent = isGlobal ? "全局对话" : "房间对话";
    elements.roomChatTab.parentElement.parentElement.querySelector("p:not(.section-kicker)").textContent =
      isGlobal
        ? "所有房间的在线玩家都能看到，请不要发送隐私信息。"
        : "消息只在本房间同步，两位玩家都能看到。";
    elements.chatInput.value = "";
    renderActiveChat();
    renderChatControls(app.room);
  }

  function closeMatchDialog() {
    if (elements.matchDialog.open) {
      elements.matchDialog.close();
    }
  }

  function renderArchivedMatch(match) {
    elements.matchDialogKicker.textContent =
      "MATCH " + String(match.number).padStart(2, "0") + " · " +
      (match.mode === "theme" ? "AI THEME" : "CLASSIC");
    elements.matchDialogTitle.textContent =
      "第 " + match.number + " 局 · " + matchResultText(match);
    elements.matchDialogDescription.textContent =
      formatMatchDate(match.endedAt) +
      " · " +
      match.rounds.length +
      " 回合 · 结果：" +
      (match.winnerWord || "平局");
    elements.matchRounds.replaceChildren();

    match.rounds.forEach((round) => {
      const row = document.createElement("article");
      const heading = document.createElement("div");
      const roundNumber = document.createElement("strong");
      const words = document.createElement("span");
      const outcome = document.createElement("p");

      row.className = "archived-round" + (round.isMatch ? " is-final" : "");
      roundNumber.textContent = "ROUND " + String(round.round).padStart(2, "0");
      words.textContent = "A：" + round.answers.A + "　B：" + round.answers.B;
      heading.append(roundNumber, words);

      if (round.mode === "theme" && round.isMatch) {
        outcome.textContent =
          "公开主题：" + round.theme +
          " · 整局 A " + round.scores.A + " 分 · B " + round.scores.B +
          " 分 · " + round.explanation;
      } else if (round.mode === "theme") {
        outcome.textContent = "本回合双方没有说出同一个词，继续围绕主题联想";
      } else {
        outcome.textContent = round.isMatch
          ? "双方成功撞词：" + round.winner
          : "本回合没有撞上";
      }

      row.append(heading, outcome);
      elements.matchRounds.appendChild(row);
    });

    elements.matchChatList.replaceChildren();
    if (!match.chat || match.chat.length === 0) {
      const empty = document.createElement("p");
      empty.className = "history-empty";
      empty.textContent = "这局没有房间聊天记录。";
      elements.matchChatList.appendChild(empty);
    } else {
      match.chat.forEach((message) => {
        const row = document.createElement("p");
        const who = document.createElement("strong");
        const time = document.createElement("time");
        who.textContent = "玩家 " + message.player;
        time.textContent = formatChatTime(message.time);
        row.append(who, " · ", time, "：", message.text);
        elements.matchChatList.appendChild(row);
      });
    }
    elements.matchChatDetails.open = false;
  }

  async function openMatch(matchId) {
    if (!matchId || !app.session) {
      return;
    }

    if (elements.winDialog.open) {
      app.dismissedWinMatchNumber = app.room?.matchNumber || null;
      elements.winDialog.close();
    }

    try {
      const payload = await request(
        "/api/rooms/" +
        encodeURIComponent(app.session.roomId) +
        "/match?token=" +
        encodeURIComponent(app.session.token) +
        "&matchId=" +
        encodeURIComponent(matchId)
      );
      renderArchivedMatch(payload.match);
      elements.matchDialog.showModal();
      elements.closeMatchDialogButton.focus();
    } catch (error) {
      showToast(error.message);
    }
  }

  function closeRoundDialog() {
    if (elements.roundDialog.open) {
      elements.roundDialog.close();
    }
  }

  function closeWinDialog() {
    if (elements.winDialog.open) {
      elements.winDialog.close();
    }
  }

  function showRoundResult(roomState) {
    const result = roomState.result;
    if (!result || elements.roundDialog.open) {
      return;
    }

    closeWinDialog();
    const isTheme = result.mode === "theme";
    elements.roundDialogKicker.textContent = isTheme
      ? "THEME · ROUND " + String(result.round).padStart(2, "0")
      : "ROUND " + String(result.round).padStart(2, "0") + " · NO MATCH";
    elements.roundDialogTitle.textContent = isTheme ? "还没有说出同一个词" : "还没想到一起";
    elements.resultWordA.textContent = result.answers.A;
    elements.resultWordB.textContent = result.answers.B;
    elements.roundDialogDescription.textContent = isTheme
      ? "新模式和默契模式一样，要继续猜词，直到双方说出完全相同的词才会结束。"
      : "两个词擦肩而过。看看彼此想到了什么，再继续下一回合。";
    if (isTheme) {
      elements.roundFeedback.hidden = false;
      elements.roundFeedback.textContent =
        "本回合不计分。双方同词后，AI 会综合整局所有词语给两人评分。";
    } else {
      elements.roundFeedback.hidden = true;
      elements.roundFeedback.textContent = "";
    }
    elements.nextRoundButton.disabled = false;
    elements.roundDialog.showModal();
    elements.nextRoundButton.focus();
  }

  function showWinResult(roomState) {
    const result = roomState.result;
    if (
      !result ||
      elements.winDialog.open ||
      app.dismissedWinMatchNumber === roomState.matchNumber
    ) {
      return;
    }

    closeRoundDialog();
    elements.winWord.textContent = result.winner;
    const latestMatch = roomState.matches?.find((match) => match.number === roomState.matchNumber);
    elements.viewWinMatchButton.hidden = !latestMatch;
    elements.viewWinMatchButton.dataset.matchId = latestMatch?.id || "";

    if (result.mode === "theme") {
      elements.winDialogKicker.textContent = "THEME JOURNEY COMPLETE";
      elements.winDialogTitle.textContent = result.winnerPlayer
        ? "玩家 " + result.winnerPlayer + " 综合评分获胜！"
        : "双方评分相同！";
      elements.winDialogDescription.textContent = result.winnerPlayer
        ? "主题是「" + result.theme + "」。双方在第 " + result.round +
          " 回合同时说出「" + result.winner + "」，DeepSeek 回看整局后判定玩家 " +
          result.winnerPlayer + " 更贴近主题。"
        : "主题是「" + result.theme + "」。双方在第 " + result.round +
          " 回合同时说出「" + result.winner + "」，但整局综合评分相同。";
      elements.winVerdict.hidden = false;
      elements.winVerdict.textContent =
        "A " + result.scores.A + " 分 · B " + result.scores.B + " 分";
    } else {
      elements.winDialogKicker.textContent = "YOU THOUGHT THE SAME";
      elements.winDialogTitle.textContent = "想到一起了！";
      elements.winDialogDescription.textContent =
        "你们在第 " + result.round + " 回合成功想到同一个词「" + result.winner + "」。";
      elements.winVerdict.hidden = true;
      elements.winVerdict.textContent = "";
    }
    elements.playAgainButton.disabled = false;
    elements.winDialog.showModal();
    elements.playAgainButton.focus();

    const celebrationKey = roomState.matchNumber + ":" + result.round;
    if (app.celebratedRound !== celebrationKey) {
      app.celebratedRound = celebrationKey;
      createConfetti();
    }
  }

  function applyState(roomState) {
    if (!roomState || !roomState.ok) {
      return;
    }

    app.room = roomState;
    elements.lobbyScreen.hidden = true;
    elements.gameScreen.hidden = false;
    elements.playerLabel.textContent =
      "你是玩家 " + app.session.player +
      (roomState.mode === "theme" ? " · AI 主题模式" : " · 默契同词模式");
    elements.roundNumber.textContent = String(roomState.round).padStart(2, "0");
    elements.roomCode.textContent = roomState.roomId;
    elements.completedRounds.textContent = String(roomState.completed);
    if (app.dismissedWinMatchNumber !== roomState.matchNumber && roomState.phase !== "won") {
      app.dismissedWinMatchNumber = null;
    }

    const message = statusMessage(roomState);
    elements.statusText.textContent = message;
    elements.statusDot.classList.toggle(
      "is-waiting",
      roomState.phase === "waiting" || roomState.phase === "judging"
    );
    elements.statusDot.classList.toggle("is-ready", roomState.phase === "playing" || roomState.phase === "won");

    renderTheme(roomState);
    renderPlayers(roomState);
    renderHistory(roomState.history);
    renderMatches(roomState.matches);
    renderActiveChat();
    renderChatControls(roomState);

    if (roomState.phase === "resolved" && roomState.result && !roomState.result.isMatch) {
      showRoundResult(roomState);
    } else if (roomState.phase === "won" && roomState.result) {
      showWinResult(roomState);
    } else {
      closeRoundDialog();
      closeWinDialog();
    }

    app.lastRound = roomState.round;
    app.lastPhase = roomState.phase;
  }

  function showInputError(index) {
    const input = elements.inputs[index];
    input.classList.remove("has-error");
    void input.offsetWidth;
    input.classList.add("has-error");
    input.focus();
    showToast(app.room?.mode === "theme" ? "先写下你的猜测再提交" : "先写下一个词再提交");
    window.setTimeout(() => input.classList.remove("has-error"), 600);
  }

  async function submitAnswer(player) {
    if (
      app.submitting ||
      !app.session ||
      !app.room ||
      app.session.player !== player ||
      app.room.phase !== "playing"
    ) {
      return;
    }

    const index = playerIndex[player];
    const word = elements.inputs[index].value.trim();
    if (!word) {
      showInputError(index);
      return;
    }

    app.submitting = true;
    elements.submitButtons[index].disabled = true;
    const buttonText = elements.submitButtons[index].querySelector("span");
    if (buttonText) {
      buttonText.textContent = "正在封存…";
    }

    try {
      const payload = await request(
        "/api/rooms/" + encodeURIComponent(app.session.roomId) + "/answers",
        {
          method: "POST",
          body: {
            token: app.session.token,
            word
          }
        }
      );
      elements.inputs[index].value = "";
      applyState(payload);
    } catch (error) {
      showToast(error.message);
      if (app.room) {
        renderPlayers(app.room);
      }
    } finally {
      app.submitting = false;
    }
  }

  async function nextRound() {
    if (!app.session || !app.room || app.room.phase !== "resolved") {
      return;
    }

    elements.nextRoundButton.disabled = true;
    try {
      const payload = await request(
        "/api/rooms/" + encodeURIComponent(app.session.roomId) + "/next",
        {
          method: "POST",
          body: {
            token: app.session.token
          }
        }
      );
      applyState(payload);
    } catch (error) {
      elements.nextRoundButton.disabled = false;
      showToast(error.message);
    }
  }

  async function sendChat() {
    if (app.sendingChat || !app.session || !app.room) {
      return;
    }

    const text = elements.chatInput.value.trim();
    if (!text) {
      elements.chatInput.focus();
      showToast("先输入聊天内容");
      return;
    }

    app.sendingChat = true;
    renderChatControls(app.room);
    const channel = app.chatChannel;
    try {
      const payload = await request(
        "/api/rooms/" +
        encodeURIComponent(app.session.roomId) +
        (channel === "global" ? "/global-chat" : "/chat"),
        {
          method: "POST",
          body: {
            token: app.session.token,
            text
          }
        }
      );
      elements.chatInput.value = "";
      if (channel === "global") {
        handleGlobalChatEvent({
          type: "message",
          message: payload.message
        });
      } else {
        applyState(payload);
      }
    } catch (error) {
      showToast(error.message);
    } finally {
      app.sendingChat = false;
      renderChatControls(app.room);
      elements.chatInput.focus();
    }
  }

  async function restartGame() {
    if (!app.session || !app.room || app.room.phase !== "won") {
      return;
    }

    const isTheme = app.room.mode === "theme";
    elements.playAgainButton.textContent = isTheme ? "生成新主题…" : "正在重新开始…";
    elements.playAgainButton.disabled = true;
    try {
      const payload = await request(
        "/api/rooms/" + encodeURIComponent(app.session.roomId) + "/restart",
        {
          method: "POST",
          body: {
            token: app.session.token
          }
        }
      );
      app.celebratedRound = null;
      app.dismissedWinMatchNumber = null;
      elements.confettiLayer.replaceChildren();
      setHistoryTab("current");
      applyState(payload);
    } catch (error) {
      elements.playAgainButton.disabled = false;
      showToast(error.message);
    } finally {
      elements.playAgainButton.textContent = "两边再玩一局";
    }
  }

  function inviteUrl() {
    const currentUrl = new URL(window.location.href);
    const localHosts = ["localhost", "127.0.0.1", "::1"];

    if (localHosts.includes(currentUrl.hostname) && app.networkUrls.length > 0) {
      try {
        const lanUrl = new URL(app.networkUrls[0]);
        lanUrl.searchParams.set("room", app.session.roomId);
        return lanUrl.toString();
      } catch {
        // 使用当前地址作为回退。
      }
    }

    currentUrl.search = "";
    currentUrl.searchParams.set("room", app.session.roomId);
    return currentUrl.toString();
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const temporary = document.createElement("textarea");
    temporary.value = text;
    temporary.setAttribute("readonly", "");
    temporary.style.position = "fixed";
    temporary.style.opacity = "0";
    document.body.appendChild(temporary);
    temporary.select();
    const copied = document.execCommand("copy");
    temporary.remove();
    if (!copied) {
      throw new Error("复制失败");
    }
  }

  async function copyInvite() {
    if (!app.session) {
      return;
    }

    try {
      await copyText(inviteUrl());
      showToast("邀请链接已复制");
    } catch {
      showToast("复制失败，请复制浏览器地址栏中的链接");
    }
  }

  function createConfetti() {
    elements.confettiLayer.replaceChildren();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const colors = ["#ed765c", "#218f84", "#f1c857", "#bfe8df", "#ffd8ca"];
    const fragment = document.createDocumentFragment();

    for (let index = 0; index < 44; index += 1) {
      const piece = document.createElement("span");
      piece.className = "confetti-piece";
      piece.style.left = Math.random() * 100 + "vw";
      piece.style.background = colors[index % colors.length];
      piece.style.borderRadius = index % 3 === 0 ? "50%" : "2px";
      piece.style.setProperty("--fall-time", (2.5 + Math.random() * 2.1).toFixed(2) + "s");
      piece.style.setProperty("--drift", (Math.random() * 22 - 11).toFixed(1) + "vw");
      piece.style.setProperty("--spin", (Math.random() * 900 - 450).toFixed(0) + "deg");
      piece.style.animationDelay = (Math.random() * 0.55).toFixed(2) + "s";
      fragment.appendChild(piece);
    }

    elements.confettiLayer.appendChild(fragment);
    window.setTimeout(() => elements.confettiLayer.replaceChildren(), 5600);
  }

  elements.createRoomButton.addEventListener("click", createRoom);

  elements.joinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    joinRoom();
  });

  elements.roomCodeInput.addEventListener("input", () => {
    elements.roomCodeInput.value = normalizeCode(elements.roomCodeInput.value);
    elements.roomCodeInput.classList.remove("has-error");
    setLobbyMessage("");
  });

  elements.forms[0].addEventListener("submit", (event) => {
    event.preventDefault();
    submitAnswer("A");
  });

  elements.forms[1].addEventListener("submit", (event) => {
    event.preventDefault();
    submitAnswer("B");
  });

  elements.inputs.forEach((input) => {
    input.addEventListener("input", () => input.classList.remove("has-error"));
  });

  elements.copyInviteButton.addEventListener("click", copyInvite);
  elements.chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendChat();
  });
  elements.roomChatTab.addEventListener("click", () => setChatChannel("room"));
  elements.globalChatTab.addEventListener("click", () => setChatChannel("global"));
  elements.currentMatchTab.addEventListener("click", () => setHistoryTab("current"));
  elements.pastMatchTab.addEventListener("click", () => setHistoryTab("past"));
  elements.viewWinMatchButton.addEventListener("click", () => {
    openMatch(elements.viewWinMatchButton.dataset.matchId);
  });
  elements.closeMatchDialogButton.addEventListener("click", closeMatchDialog);
  elements.closeMatchDialogFooter.addEventListener("click", closeMatchDialog);
  elements.nextRoundButton.addEventListener("click", nextRound);
  elements.playAgainButton.addEventListener("click", restartGame);

  elements.roundDialog.addEventListener("cancel", (event) => event.preventDefault());
  elements.winDialog.addEventListener("cancel", (event) => event.preventDefault());

  async function boot() {
    setChatChannel("room");
    setHistoryTab("current");
    const queryCode = normalizeCode(new URLSearchParams(window.location.search).get("room"));
    if (queryCode) {
      elements.roomCodeInput.value = queryCode;
    }

    await loadHealth();

    const saved = readSession();
    if (saved && (!queryCode || saved.roomId === queryCode)) {
      const restored = await restoreSession(saved);
      if (!restored && queryCode) {
        setLobbyMessage("上一次的房间已经失效，请重新加入");
      }
    } else if (queryCode) {
      setLobbyMessage("输入的房间号已填好，点击加入即可", false);
      elements.joinRoomButton.focus();
    }
  }

  boot();
})();
