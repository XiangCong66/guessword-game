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
    joinForm: document.getElementById("joinForm"),
    roomCodeInput: document.getElementById("roomCodeInput"),
    joinRoomButton: document.getElementById("joinRoomButton"),
    lobbyMessage: document.getElementById("lobbyMessage"),
    playerLabel: document.getElementById("playerLabel"),
    roundNumber: document.getElementById("roundNumber"),
    roomCode: document.getElementById("roomCode"),
    copyInviteButton: document.getElementById("copyInviteButton"),
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
    historyList: document.getElementById("historyList"),
    roundDialog: document.getElementById("roundDialog"),
    roundDialogKicker: document.getElementById("roundDialogKicker"),
    roundDialogDescription: document.getElementById("roundDialogDescription"),
    resultWordA: document.getElementById("resultWordA"),
    resultWordB: document.getElementById("resultWordB"),
    nextRoundButton: document.getElementById("nextRoundButton"),
    winDialog: document.getElementById("winDialog"),
    winWord: document.getElementById("winWord"),
    winDialogDescription: document.getElementById("winDialogDescription"),
    playAgainButton: document.getElementById("playAgainButton"),
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
    celebratedRound: null,
    lastRound: null,
    lastPhase: null
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
  }

  function enterRoom(roomState, nextSession) {
    app.session = nextSession;
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
    setButtonBusy(elements.createRoomButton, true, "正在创建…");
    setLobbyMessage("");

    try {
      const payload = await request("/api/rooms", {
        method: "POST"
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
      return "房间已创建，正在等待朋友加入";
    }

    if (roomState.phase === "won") {
      return "撞词成功，这一局默契通关";
    }

    if (roomState.phase === "resolved") {
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

    return "第 " + roomState.round + " 回合，等你们各写下一个词";
  }

  function renderPlayers(roomState) {
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
      elements.answerLabels[index].textContent = isOwn ? "你的词" : "玩家 " + player + " 的词";

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
        input.placeholder = playerState.online ? "对方正在想词" : "对方暂时离线";
        elements.wordStates[index].textContent = "实时同步";
      } else if (!canPlay) {
        input.placeholder = "本回合暂不可输入";
        elements.wordStates[index].textContent = "等待揭晓";
      } else {
        input.placeholder = "写下一个词";
        elements.wordStates[index].textContent = "等待你写";
      }

      const buttonLabel = button.querySelector("span");
      if (buttonLabel) {
        buttonLabel.textContent = isSubmitted ? "已提交，等待揭晓" : "提交这个词";
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

      chip.className = "history-chip" + (entry.isMatch ? " is-match" : "");
      round.textContent = "R" + String(entry.round).padStart(2, "0");
      wordA.textContent = entry.answers.A;
      separator.textContent = entry.isMatch ? "＝" : "↔";
      wordB.textContent = entry.answers.B;
      chip.append(round, wordA, separator, wordB);
      elements.historyList.appendChild(chip);
    });
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
    elements.roundDialogKicker.textContent =
      "ROUND " + String(result.round).padStart(2, "0") + " · NO MATCH";
    elements.resultWordA.textContent = result.answers.A;
    elements.resultWordB.textContent = result.answers.B;
    elements.roundDialogDescription.textContent =
      "两个词擦肩而过。看看彼此想到了什么，再继续下一回合。";
    elements.nextRoundButton.disabled = false;
    elements.roundDialog.showModal();
    elements.nextRoundButton.focus();
  }

  function showWinResult(roomState) {
    const result = roomState.result;
    if (!result || elements.winDialog.open) {
      return;
    }

    closeRoundDialog();
    elements.winWord.textContent = result.winner;
    elements.winDialogDescription.textContent =
      "你们在第 " + result.round + " 回合成功想到同一个词「" + result.winner + "」。";
    elements.playAgainButton.disabled = false;
    elements.winDialog.showModal();
    elements.playAgainButton.focus();

    if (app.celebratedRound !== result.round) {
      app.celebratedRound = result.round;
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
    elements.playerLabel.textContent = "你是玩家 " + app.session.player;
    elements.roundNumber.textContent = String(roomState.round).padStart(2, "0");
    elements.roomCode.textContent = roomState.roomId;
    elements.completedRounds.textContent = String(roomState.completed);

    const message = statusMessage(roomState);
    elements.statusText.textContent = message;
    elements.statusDot.classList.toggle("is-waiting", roomState.phase === "waiting");
    elements.statusDot.classList.toggle("is-ready", roomState.phase === "playing" || roomState.phase === "won");

    renderPlayers(roomState);
    renderHistory(roomState.history);

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
    showToast("先写下一个词再提交");
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

  async function restartGame() {
    if (!app.session || !app.room || app.room.phase !== "won") {
      return;
    }

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
      elements.confettiLayer.replaceChildren();
      applyState(payload);
    } catch (error) {
      elements.playAgainButton.disabled = false;
      showToast(error.message);
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
  elements.nextRoundButton.addEventListener("click", nextRound);
  elements.playAgainButton.addEventListener("click", restartGame);

  elements.roundDialog.addEventListener("cancel", (event) => event.preventDefault());
  elements.winDialog.addEventListener("cancel", (event) => event.preventDefault());

  async function boot() {
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
