(function () {
  const initialState = window.__DASHBOARD__ || { selectedSession: null, sessions: [], controlData: {} };
  let currentSessionId = initialState?.selectedSession?.sessionId || "";
  let sessionList = Array.isArray(initialState?.sessions) ? initialState.sessions : [];
  let controlData = initialState?.controlData || {};
  let groupList = Array.isArray(controlData?.groups) ? controlData.groups : [];
  let phoneDirty = false;

  const pairingForm = document.querySelector("[data-pairing-form]");
  const sessionForm = document.querySelector("[data-session-form]");
  const caseForm = document.querySelector("[data-case-form]");
  const deleteCaseForm = document.querySelector("[data-delete-case-form]");
  const deleteFunctionForm = document.querySelector("[data-delete-function-form]");
  const phoneInput = document.querySelector("[data-pairing-phone]");
  const sessionNameInput = document.querySelector("[data-session-name]");
  const sessionIdInput = document.querySelector("[data-session-id]");
  const submitButton = document.querySelector("[data-pairing-submit]");
  const liveMessage = document.querySelector("[data-live-message]");
  const sessionListNode = document.querySelector("[data-session-list]");

  const userImportForm = document.querySelector("[data-user-import-form]");
  const userActionForm = document.querySelector("[data-user-action-form]");
  const groupRefreshForm = document.querySelector("[data-group-refresh-form]");
  const groupSelect = document.querySelector("[data-group-select]");
  const botSettingForms = [...document.querySelectorAll("[data-bot-setting-form]")];
  const dashboardSettingForm = document.querySelector("[data-dashboard-setting-form]");
  const menuBuilderForm = document.querySelector("[data-menu-builder-form]");

  const nodes = {
    code: document.querySelector("[data-pairing-code]"),
    status: document.querySelector("[data-pairing-status]"),
    updatedAt: document.querySelector("[data-pairing-updated]"),
    connection: document.querySelector("[data-pairing-connection]"),
    registered: document.querySelector("[data-pairing-registered]"),
    jid: document.querySelector("[data-pairing-jid]"),
    error: document.querySelector("[data-pairing-error]"),
    overviewStatus: document.querySelector("[data-overview-status]"),
    overviewPhone: document.querySelector("[data-overview-phone]"),
    overviewJid: document.querySelector("[data-overview-jid]"),
    metricUsers: document.querySelector("[data-metric-users]"),
    metricGroups: document.querySelector("[data-metric-groups]"),
    metricTransactions: document.querySelector("[data-metric-transactions]"),
    metricCases: document.querySelector("[data-metric-cases]"),
    metricRegisteredUsers: document.querySelector("[data-metric-registered-users]"),
    metricBannedChats: document.querySelector("[data-metric-banned-chats]"),
    inspectorStatus: document.querySelector("[data-inspector-status]"),
    inspectorLine: document.querySelector("[data-inspector-line]"),
    inspectorCase: document.querySelector("[data-inspector-case]"),
    inspectorFunction: document.querySelector("[data-inspector-function]"),
    inspectorError: document.querySelector("[data-inspector-error]"),
    selectedSessionName: document.querySelector("[data-selected-session-name]"),
    selectedSessionId: document.querySelector("[data-selected-session-id]"),
    userSummary: document.querySelector("[data-user-summary]"),
    groupSummary: document.querySelector("[data-group-summary]"),
    leaderboardOutput: document.querySelector("[data-leaderboard-output]"),
    commandStatsOutput: document.querySelector("[data-command-stats-output]"),
    warningOutput: document.querySelector("[data-warning-output]"),
    snippetLibrary: document.querySelector("[data-snippet-library]"),
    menuPreview: document.querySelector("[data-menu-preview]"),
    cloudflareOutput: document.querySelector("[data-cloudflare-output]")
  };

  const prettyDate = (value) => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("id-ID");
  };

  const formatDuration = (ms = 0) => {
    const totalHours = Math.max(1, Math.ceil(Number(ms || 0) / (1000 * 60 * 60)));
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    if (days && hours) return `${days} hari ${hours} jam`;
    if (days) return `${days} hari`;
    return `${hours} jam`;
  };

  const hashString = (value = "") => {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = (hash * 31 + value.charCodeAt(index)) | 0;
    }
    return Math.abs(hash);
  };

  const getSessionAccent = (session) => {
    const palette = [
      ["#7dd3fc", "#38bdf8", "#0f172a"],
      ["#f9a8d4", "#fb7185", "#1f1020"],
      ["#86efac", "#22c55e", "#07150f"],
      ["#fcd34d", "#f59e0b", "#191205"],
      ["#c4b5fd", "#8b5cf6", "#130b24"],
      ["#67e8f9", "#06b6d4", "#07171a"]
    ];
    return palette[hashString(session?.sessionId || session?.displayName || "default") % palette.length];
  };

  const paintSessionCanvas = (canvas, session) => {
    if (!canvas) return;
    const card = canvas.closest(".session-item");
    const width = Math.max(card?.clientWidth || 280, 280);
    const height = 88;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const [accentA, accentB, accentDark] = getSessionAccent(session);
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, `${accentA}22`);
    gradient.addColorStop(0.5, `${accentB}1d`);
    gradient.addColorStop(1, `${accentDark}ee`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const seed = hashString(session?.sessionId || "default");
    for (let index = 0; index < 3; index += 1) {
      const x = (seed + index * 63) % width;
      const radius = 30 + ((seed >> index) % 42);
      ctx.beginPath();
      ctx.strokeStyle = index === 0 ? `${accentA}99` : `${accentB}66`;
      ctx.lineWidth = 1.25 + index;
      ctx.arc(x, 24 + index * 17, radius, Math.PI * 0.14, Math.PI * 1.42);
      ctx.stroke();
    }
  };

  const paintAllSessionCanvases = () => {
    const cards = sessionListNode ? [...sessionListNode.querySelectorAll("[data-session-card]")] : [];
    cards.forEach((card) => {
      const sessionId = card.dataset.sessionCard || "";
      const session = sessionList.find((item) => item.sessionId === sessionId) || { sessionId };
      paintSessionCanvas(card.querySelector("[data-session-canvas]"), session);
    });
  };

  const closeAllMenus = () => {
    document.querySelectorAll("[data-session-menu]").forEach((menu) => {
      menu.hidden = true;
      menu.classList.remove("is-open");
    });
    document.querySelectorAll("[data-session-menu-toggle]").forEach((button) => {
      button.setAttribute("aria-expanded", "false");
    });
  };

  const setLiveMessage = (message, type) => {
    if (!liveMessage) return;
    if (!message) {
      liveMessage.hidden = true;
      liveMessage.textContent = "";
      liveMessage.classList.remove("success", "error");
      return;
    }
    liveMessage.hidden = false;
    liveMessage.textContent = message;
    liveMessage.classList.remove("success", "error");
    if (type) liveMessage.classList.add(type);
  };

  const renderSessionList = (sessions) => {
    if (!sessionListNode) return;
    sessionListNode.innerHTML = "";

    if (!sessions || !sessions.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "belum ada session. buat session baru dulu di atas.";
      sessionListNode.appendChild(empty);
      return;
    }

    sessions.forEach((session) => {
      const card = document.createElement("article");
      card.className = `session-item${currentSessionId === session.sessionId ? " is-active" : ""}`;
      card.dataset.sessionCard = session.sessionId;
      card.innerHTML = `
        <canvas class="session-item-canvas" data-session-canvas></canvas>
        <div class="session-item-top">
          <button type="button" class="session-item-main" data-session-pick="${session.sessionId}">
            <span class="session-item-title">${session.displayName || "default"}</span>
            <span class="session-item-meta">${session.phone || "belum ada nomor"} · ${session.status || "idle"}</span>
          </button>
          <div class="session-menu-wrap">
            <button type="button" class="icon-button session-menu-button" data-session-menu-toggle="${session.sessionId}" aria-label="menu session" aria-expanded="false">
              <i class="fa-solid fa-bars"></i>
            </button>
            <div class="session-menu" data-session-menu="${session.sessionId}" hidden>
              <button type="button" class="session-menu-close" data-session-menu-close="${session.sessionId}"><i class="fa-solid fa-xmark"></i> tutup</button>
              <button type="button" data-session-pick="${session.sessionId}"><i class="fa-solid fa-hand-pointer"></i> pilih</button>
              <button type="button" data-session-power="${session.sessionId}" data-session-mode="active"><i class="fa-solid fa-power-off"></i> aktif</button>
              <button type="button" data-session-power="${session.sessionId}" data-session-mode="off"><i class="fa-solid fa-moon"></i> off</button>
              <button type="button" data-session-restart="${session.sessionId}"><i class="fa-solid fa-rotate-right"></i> restart</button>
              <button type="button" data-session-delete="${session.sessionId}"><i class="fa-solid fa-trash"></i> hapus</button>
            </div>
          </div>
        </div>
        <div class="session-badges">
          <span class="mini-pill"><i class="fa-solid fa-signal"></i> ${session.connection || "idle"}</span>
          <span class="mini-pill"><i class="fa-solid fa-plug-circle-check"></i> ${session.isEnabled === false ? "off" : "active"}</span>
        </div>
      `;
      sessionListNode.appendChild(card);
    });

    paintAllSessionCanvases();
  };

  const renderPairing = (state, options = {}) => {
    if (!state) return;
    const shouldSyncPhone = Boolean(options.forcePhoneSync);

    currentSessionId = state.sessionId || currentSessionId || "";
    if (sessionIdInput) sessionIdInput.value = currentSessionId;
    if (phoneInput && (shouldSyncPhone || !phoneDirty)) {
      phoneInput.value = state.phone || "";
      phoneDirty = false;
    }
    if (nodes.code) nodes.code.textContent = state.lastCode || "-";
    if (nodes.updatedAt) nodes.updatedAt.textContent = prettyDate(state.updatedAt);
    if (nodes.connection) nodes.connection.textContent = state.connection || "-";
    if (nodes.registered) nodes.registered.textContent = state.registered ? "true" : "false";
    if (nodes.jid) nodes.jid.textContent = state.connectedJid || "-";
    if (nodes.error) nodes.error.textContent = state.lastError || "-";
    if (nodes.overviewStatus) nodes.overviewStatus.textContent = state.status || "-";
    if (nodes.overviewPhone) nodes.overviewPhone.textContent = state.phone || "-";
    if (nodes.overviewJid) nodes.overviewJid.textContent = state.connectedJid || "-";
    if (nodes.selectedSessionName) nodes.selectedSessionName.textContent = state.displayName || "belum dipilih";
    if (nodes.selectedSessionId) nodes.selectedSessionId.textContent = state.sessionId || "-";

    if (nodes.status) {
      nodes.status.textContent = state.status || "idle";
      nodes.status.className = `status-pill status-${state.status || "idle"}`;
    }

    if (submitButton) {
      submitButton.disabled = Boolean(state.requestInFlight) || state.isEnabled === false;
      submitButton.innerHTML = state.requestInFlight
        ? '<i class="fa-solid fa-spinner fa-spin"></i> meminta pairing...'
        : '<i class="fa-solid fa-link"></i> minta pairing code';
    }
  };

  const renderMetrics = (metrics) => {
    if (!metrics) return;
    if (nodes.metricUsers) nodes.metricUsers.textContent = metrics.totalUsers ?? "0";
    if (nodes.metricGroups) nodes.metricGroups.textContent = metrics.totalGroups ?? "0";
    if (nodes.metricTransactions) nodes.metricTransactions.textContent = metrics.totalTransactions ?? "0";
    if (nodes.metricCases) nodes.metricCases.textContent = metrics.totalCases ?? "0";
    if (nodes.metricRegisteredUsers) nodes.metricRegisteredUsers.textContent = metrics.totalRegisteredUsers ?? "0";
    if (nodes.metricBannedChats) nodes.metricBannedChats.textContent = metrics.totalBannedChats ?? "0";
  };

  const renderInspector = (inspector) => {
    if (!inspector) return;
    if (nodes.inspectorStatus) nodes.inspectorStatus.textContent = inspector.ok ? "aman" : "error";
    if (nodes.inspectorLine) nodes.inspectorLine.textContent = inspector.ok ? "tidak ada error syntax" : `baris ${inspector.line || "-"}`;
    if (nodes.inspectorCase) nodes.inspectorCase.value = inspector.caseBlock || "";
    if (nodes.inspectorFunction) nodes.inspectorFunction.value = inspector.functionBlock || "";
    if (nodes.inspectorError) nodes.inspectorError.value = inspector.error || "";
  };

  const renderGroups = (groups) => {
    groupList = Array.isArray(groups) ? groups : [];
    if (!groupSelect) return;
    const current = groupSelect.value;
    groupSelect.innerHTML = '<option value="">pilih grup</option>';
    groupList.forEach((group) => {
      const option = document.createElement("option");
      option.value = group.id;
      option.textContent = `${group.subject} (${group.participantsCount})`;
      groupSelect.appendChild(option);
    });
    if (groupList.some((group) => group.id === current)) {
      groupSelect.value = current;
    }
    renderSelectedGroupSummary();
  };

  const renderControl = (control) => {
    if (!control) return;
    controlData = control;
    renderGroups(control.groups || []);

    if (nodes.userSummary) {
      const users = (control.users || []).slice(0, 12).map((user) => `${user.number} | ${user.name} | limit ${user.limit} | ${user.banned ? "banned" : "aktif"}`);
      nodes.userSummary.textContent = users.length ? users.join("\n") : "belum ada data user.";
    }

    if (nodes.leaderboardOutput) {
      nodes.leaderboardOutput.textContent = (control.leaderboard || [])
        .map((item, index) => `${index + 1}. ${item.number} | cmd ${item.commandCount} | beli ${item.totalBeli}`)
        .join("\n") || "leaderboard kosong.";
    }

    if (nodes.commandStatsOutput) {
      nodes.commandStatsOutput.textContent = (control.commandStats || [])
        .map((item) => `${item.jid} | ${item.count} command | ${prettyDate(item.lastUsedAt)}`)
        .join("\n") || "statistik command belum ada.";
    }

    if (nodes.warningOutput) {
      nodes.warningOutput.textContent = (control.warnings || [])
        .map((item) => `${item.groupId} | ${item.jid} | warn ${item.count} | ${item.restrictionActive ? `blokir ${formatDuration(item.remainingMs)}` : "normal"}`)
        .join("\n") || "warning grup kosong.";
    }

    if (dashboardSettingForm) {
      dashboardSettingForm.elements.publicUrl.value = control.dashboardSettings?.publicUrl || "";
      dashboardSettingForm.elements.customDomain.value = control.dashboardSettings?.customDomain || "";
      dashboardSettingForm.elements.maintenanceMode.checked = Boolean(control.dashboardSettings?.maintenanceMode);
    }

    if (nodes.cloudflareOutput) {
      nodes.cloudflareOutput.textContent = [
        `public url: ${control.cloudflare?.url || control.dashboardSettings?.publicUrl || "-"}`,
        `updated: ${prettyDate(control.cloudflare?.updatedAt || null)}`,
        `custom domain: ${control.dashboardSettings?.customDomain || "-"}`,
        `maintenance: ${control.dashboardSettings?.maintenanceMode ? "on" : "off"}`
      ].join("\n");
    }

    botSettingForms.forEach((form) => {
      const mode = form.dataset.botSettingForm;
      if (mode === "autoai") {
        form.elements.enabled.value = String(Boolean(control.botSettings?.autoAi));
      }
      if (mode === "autostory") {
        form.elements.interval.value = control.botSettings?.autoStory?.interval || "";
        form.elements.text.value = control.botSettings?.autoStory?.message?.text || "";
      }
      if (mode === "autojpm") {
        form.elements.intervalMs.value = control.botSettings?.autoJpm?.interval || "";
        form.elements.text.value = control.botSettings?.autoJpm?.message?.text || "";
      }
      if (mode === "channelreact") {
        const defaults = control.botSettings?.channelReact?.dashboardDefaults || {};
        form.elements.link.value = defaults.link || "";
        form.elements.emoji.value = defaults.emoji || "";
        form.elements.count.value = defaults.count || 10;
      }
    });
  };

  const renderSelectedGroupSummary = () => {
    if (!nodes.groupSummary) return;
    const selectedId = groupSelect?.value || "";
    const group = groupList.find((item) => item.id === selectedId);
    if (!group) {
      nodes.groupSummary.textContent = "pilih grup dulu untuk melihat status visual.";
      return;
    }
    nodes.groupSummary.textContent = [
      `${group.subject}`,
      `id: ${group.id}`,
      `anggota: ${group.participantsCount}`,
      `open: ${group.announce ? "tidak" : "ya"}`,
      `anti-link: ${group.antilink ? "on" : "off"}`,
      `welcome: ${group.welcome ? "on" : "off"}`,
      `goodbye: ${group.goodbye ? "on" : "off"}`,
      `warning aktif: ${group.warningCount}`,
      `punishment aktif: ${group.restrictedCount}`,
      `ban chat: ${group.bannedChat ? "ya" : "tidak"}`
    ].join("\n");
  };

  const refreshStatus = async (options = {}) => {
    try {
      const query = currentSessionId ? `?sessionId=${encodeURIComponent(currentSessionId)}` : "";
      const response = await fetch(`/api/pairing/status${query}`, { headers: { Accept: "application/json" } });
      if (!response.ok) return;
      const payload = await response.json();
      if (!payload.ok) return;

      sessionList = payload.data?.sessions || sessionList;
      renderSessionList(sessionList);
      renderPairing(payload.data?.pairing, { forcePhoneSync: Boolean(options.forcePhoneSync) });
      renderMetrics(payload.data?.metrics);
    } catch {
      setLiveMessage("gagal mengambil status pairing terbaru.", "error");
    }
  };

  const refreshControlData = async () => {
    try {
      const query = currentSessionId ? `?sessionId=${encodeURIComponent(currentSessionId)}` : "";
      const response = await fetch(`/api/dashboard/control-data${query}`, { headers: { Accept: "application/json" } });
      const payload = await response.json();
      if (!response.ok || !payload.ok) return;
      renderMetrics(payload.data?.metrics);
      renderControl(payload.data?.control);
    } catch {}
  };

  const postJson = async (url, body) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(body || {})
    });
    const payload = await response.json();
    return { response, payload };
  };

  const deleteRequest = async (url) => {
    const response = await fetch(url, {
      method: "DELETE",
      headers: { Accept: "application/json" }
    });
    const payload = await response.json();
    return { response, payload };
  };

  const fetchInspector = async () => {
    try {
      const response = await fetch("/api/message/inspect", { headers: { Accept: "application/json" } });
      const payload = await response.json();
      if (!response.ok || !payload.ok) return;
      renderInspector(payload.data?.inspector);
      renderMetrics(payload.data?.metrics);
    } catch {}
  };

  const handleJsonResult = async ({ response, payload }, successMessage) => {
    if (payload?.data?.metrics) renderMetrics(payload.data.metrics);
    if (payload?.data?.inspector) renderInspector(payload.data.inspector);
    if (payload?.data?.control) renderControl(payload.data.control);
    if (payload?.data?.groups) renderGroups(payload.data.groups);
    if (!response.ok || !payload.ok) {
      setLiveMessage(payload.message || "aksi gagal dijalankan.", "error");
      return false;
    }
    setLiveMessage(payload.message || successMessage, "success");
    return true;
  };

  if (phoneInput) {
    phoneInput.addEventListener("input", () => {
      phoneDirty = true;
    });
  }

  if (groupSelect) {
    groupSelect.addEventListener("change", renderSelectedGroupSummary);
  }

  if (sessionForm) {
    sessionForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const sessionName = sessionNameInput ? sessionNameInput.value.trim() : "";
      try {
        const submit = sessionForm.querySelector("button[type='submit']");
        setButtonLoading(submit, true, "membuat session...");
        const { response, payload } = await postJson("/api/sessions", { sessionName });
        if (!response.ok || !payload.ok) {
          setLiveMessage(payload.message || "gagal membuat session.", "error");
          return;
        }
        sessionList = payload.data?.sessions || sessionList;
        currentSessionId = payload.data?.session?.sessionId || currentSessionId;
        renderSessionList(sessionList);
        renderPairing(payload.data?.session, { forcePhoneSync: true });
        if (sessionNameInput) sessionNameInput.value = "";
        setLiveMessage(payload.message || "session berhasil dibuat.", "success");
        await refreshControlData();
      } catch {
        setLiveMessage("terjadi error saat membuat session.", "error");
      } finally {
        const submit = sessionForm.querySelector("button[type='submit']");
        setButtonLoading(submit, false);
      }
    });
  }

  if (caseForm) {
    caseForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const caseName = caseForm.querySelector("[data-case-name]")?.value.trim() || "";
      const caseBody = caseForm.querySelector("[data-case-body]")?.value || "";
      try {
        const { response, payload } = await postJson("/api/message/cases", { caseName, caseBody });
        const ok = await handleJsonResult({ response, payload }, "case berhasil ditambah.");
        if (ok) caseForm.reset();
      } catch {
        setLiveMessage("terjadi error saat menambah case.", "error");
      }
    });
  }

  if (deleteCaseForm) {
    deleteCaseForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const caseName = deleteCaseForm.querySelector("input[name='caseName']")?.value.trim() || "";
      try {
        const { response, payload } = await postJson("/api/message/cases/delete", { caseName });
        const ok = await handleJsonResult({ response, payload }, "case berhasil dihapus.");
        if (ok) deleteCaseForm.reset();
      } catch {
        setLiveMessage("terjadi error saat menghapus case.", "error");
      }
    });
  }

  if (deleteFunctionForm) {
    deleteFunctionForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const functionName = deleteFunctionForm.querySelector("input[name='functionName']")?.value.trim() || "";
      try {
        const { response, payload } = await postJson("/api/message/functions/delete", { functionName });
        const ok = await handleJsonResult({ response, payload }, "function berhasil dihapus.");
        if (ok) deleteFunctionForm.reset();
      } catch {
        setLiveMessage("terjadi error saat menghapus function.", "error");
      }
    });
  }

  if (userImportForm) {
    userImportForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const csv = userImportForm.elements.csv.value || "";
      const submit = userImportForm.querySelector("button[type='submit']");
      setButtonLoading(submit, true, "import csv...");
      try {
        const { response, payload } = await postJson("/api/dashboard/users/import-csv", { csv });
        const ok = await handleJsonResult({ response, payload }, "csv user berhasil diimport.");
        if (ok) userImportForm.reset();
      } finally {
        setButtonLoading(submit, false);
      }
    });
  }

  if (userActionForm) {
    userActionForm.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-user-action]");
      if (!button) return;
      const action = button.dataset.userAction;
      const target = userActionForm.elements.target.value.trim();
      const amount = Number(userActionForm.elements.amount.value || 0);
      setButtonLoading(button, true, "menjalankan...");
      try {
        const { response, payload } = await postJson("/api/dashboard/users/action", { action, target, amount });
        await handleJsonResult({ response, payload }, "aksi user berhasil dijalankan.");
      } finally {
        setButtonLoading(button, false);
      }
    });
  }

  if (groupRefreshForm) {
    groupRefreshForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!currentSessionId) {
        setLiveMessage("pilih session dulu sebelum memuat grup.", "error");
        return;
      }
      const submit = groupRefreshForm.querySelector("button[type='submit']");
      setButtonLoading(submit, true, "memuat grup...");
      try {
        const response = await fetch(`/api/dashboard/groups?sessionId=${encodeURIComponent(currentSessionId)}`, {
          headers: { Accept: "application/json" }
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          setLiveMessage(payload.message || "gagal memuat grup session.", "error");
          return;
        }
        renderControl(payload.data?.control);
        setLiveMessage("daftar grup per session berhasil dimuat.", "success");
      } finally {
        setButtonLoading(submit, false);
      }
    });

    groupRefreshForm.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-group-action]");
      if (!button) return;
      if (!currentSessionId) {
        setLiveMessage("pilih session dulu.", "error");
        return;
      }
      const groupId = groupSelect?.value || "";
      const target = groupRefreshForm.elements.target.value.trim();
      const action = button.dataset.groupAction;
      setButtonLoading(button, true, "memproses...");
      try {
        const { response, payload } = await postJson("/api/dashboard/groups/action", {
          sessionId: currentSessionId,
          groupId,
          target,
          action
        });
        await handleJsonResult({ response, payload }, "aksi grup berhasil dijalankan.");
      } finally {
        setButtonLoading(button, false);
      }
    });
  }

  document.querySelectorAll("[data-group-setting]").forEach((button) => {
    button.addEventListener("click", async () => {
      const groupId = groupSelect?.value || "";
      const group = groupList.find((item) => item.id === groupId);
      if (!groupId || !group) {
        setLiveMessage("pilih grup dulu.", "error");
        return;
      }
      const key = button.dataset.groupSetting;
      const nextValue = !Boolean(group[key]);
      setButtonLoading(button, true, "menyimpan...");
      try {
        const { response, payload } = await postJson("/api/dashboard/groups/settings", { groupId, key, value: nextValue });
        const ok = await handleJsonResult({ response, payload }, "setting grup berhasil diperbarui.");
        if (ok && currentSessionId) {
          const refresh = await fetch(`/api/dashboard/groups?sessionId=${encodeURIComponent(currentSessionId)}`, { headers: { Accept: "application/json" } });
          const refreshPayload = await refresh.json();
          if (refresh.ok && refreshPayload.ok) renderControl(refreshPayload.data?.control);
        }
      } finally {
        setButtonLoading(button, false);
      }
    });
  });

  botSettingForms.forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const action = form.dataset.botSettingForm;
      const payload = Object.fromEntries(new FormData(form).entries());
      payload.enabled = payload.enabled === "true";
      const submit = form.querySelector("button[type='submit']");
      setButtonLoading(submit, true, "menyimpan...");
      try {
        const result = await postJson("/api/dashboard/settings", { action, payload });
        await handleJsonResult(result, "setting bot berhasil disimpan.");
      } finally {
        setButtonLoading(submit, false);
      }
    });
  });

  if (dashboardSettingForm) {
    dashboardSettingForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = {
        publicUrl: dashboardSettingForm.elements.publicUrl.value.trim(),
        customDomain: dashboardSettingForm.elements.customDomain.value.trim(),
        maintenanceMode: dashboardSettingForm.elements.maintenanceMode.checked
      };
      const submit = dashboardSettingForm.querySelector("button[type='submit']");
      setButtonLoading(submit, true, "menyimpan...");
      try {
        const result = await postJson("/api/dashboard/settings", { action: "dashboard", payload });
        await handleJsonResult(result, "setting dashboard berhasil disimpan.");
      } finally {
        setButtonLoading(submit, false);
      }
    });
  }

  document.querySelector("[data-copy-public-url]")?.addEventListener("click", async () => {
    const value = dashboardSettingForm?.elements.publicUrl.value.trim() || controlData?.dashboardSettings?.publicUrl || "";
    if (!value) {
      setLiveMessage("public url cloudflare belum diisi.", "error");
      return;
    }
    await navigator.clipboard.writeText(value);
    setLiveMessage("public url berhasil dicopy.", "success");
  });

  document.querySelector("[data-template-buttons]")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-template-id]");
    if (!button) return;
    const templateId = button.dataset.templateId;
    setButtonLoading(button, true, "memasang...");
    try {
      const result = await postJson("/api/dashboard/templates/apply", { templateId });
      await handleJsonResult(result, "template case berhasil dipasang.");
    } finally {
      setButtonLoading(button, false);
    }
  });

  if (menuBuilderForm) {
    menuBuilderForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const title = menuBuilderForm.elements.title.value.trim();
      const commands = menuBuilderForm.elements.commands.value.trim();
      const submit = menuBuilderForm.querySelector("button[type='submit']");
      setButtonLoading(submit, true, "membuat...");
      try {
        const { response, payload } = await postJson("/api/dashboard/menu/preview", { title, commands });
        if (!response.ok || !payload.ok) {
          setLiveMessage(payload.message || "gagal membuat preview menu.", "error");
          return;
        }
        if (nodes.menuPreview) nodes.menuPreview.value = payload.data?.preview || "";
        setLiveMessage("preview menu berhasil dibuat.", "success");
      } finally {
        setButtonLoading(submit, false);
      }
    });
  }

  if (sessionListNode) {
    sessionListNode.addEventListener("click", async (event) => {
      const menuToggle = event.target.closest("[data-session-menu-toggle]");
      if (menuToggle) {
        const sessionId = menuToggle.dataset.sessionMenuToggle || "";
        const menu = sessionListNode.querySelector(`[data-session-menu="${sessionId}"]`);
        const isHidden = menu?.hidden !== false;
        closeAllMenus();
        if (menu && isHidden) {
          menu.hidden = false;
          menu.classList.add("is-open");
          menuToggle.setAttribute("aria-expanded", "true");
        }
        return;
      }

      const menuClose = event.target.closest("[data-session-menu-close]");
      if (menuClose) {
        closeAllMenus();
        return;
      }

      const powerButton = event.target.closest("[data-session-power]");
      if (powerButton) {
        const sessionId = powerButton.dataset.sessionPower || "";
        const mode = powerButton.dataset.sessionMode || "off";
        closeAllMenus();
        try {
          const { response, payload } = await postJson(`/api/sessions/${encodeURIComponent(sessionId)}/power`, { mode });
          sessionList = payload.data?.sessions || sessionList;
          renderSessionList(sessionList);
          renderMetrics(payload.data?.metrics);
          if (currentSessionId === sessionId && payload.data?.pairing) {
            renderPairing(payload.data.pairing, { forcePhoneSync: mode !== "off" });
          }
          if (!response.ok || !payload.ok) {
            setLiveMessage(payload.message || "gagal mengubah power session.", "error");
            return;
          }
          setLiveMessage(payload.message || "power session diperbarui.", "success");
          await refreshStatus({ forcePhoneSync: mode !== "off" });
          await refreshControlData();
        } catch {
          setLiveMessage("terjadi error saat mengubah power session.", "error");
        }
        return;
      }

      const restartButton = event.target.closest("[data-session-restart]");
      if (restartButton) {
        const targetSessionId = restartButton.dataset.sessionRestart || "";
        closeAllMenus();
        if (!targetSessionId) return;
        try {
          const { response, payload } = await postJson(`/api/sessions/${encodeURIComponent(targetSessionId)}/restart`);
          sessionList = payload.data?.sessions || sessionList;
          renderSessionList(sessionList);
          renderMetrics(payload.data?.metrics);
          if (currentSessionId === targetSessionId && payload.data?.pairing) {
            renderPairing(payload.data.pairing, { forcePhoneSync: false });
          }
          if (!response.ok || !payload.ok) {
            setLiveMessage(payload.message || "gagal restart session.", "error");
            return;
          }
          setLiveMessage(payload.message || "session berhasil direstart.", "success");
          await refreshControlData();
        } catch {
          setLiveMessage("terjadi error saat restart session.", "error");
        }
        return;
      }

      const deleteButton = event.target.closest("[data-session-delete]");
      if (deleteButton) {
        const targetSessionId = deleteButton.dataset.sessionDelete || "";
        closeAllMenus();
        if (!targetSessionId) return;
        try {
          const { response, payload } = await deleteRequest(`/api/sessions/${encodeURIComponent(targetSessionId)}`);
          sessionList = payload.data?.sessions || [];
          if (currentSessionId === targetSessionId) currentSessionId = sessionList[0]?.sessionId || "";
          renderSessionList(sessionList);
          renderMetrics(payload.data?.metrics);
          if (!response.ok || !payload.ok) {
            setLiveMessage(payload.message || "gagal menghapus session.", "error");
            return;
          }
          setLiveMessage(payload.message || "session berhasil dihapus.", "success");
          await refreshStatus({ forcePhoneSync: true });
          await refreshControlData();
        } catch {
          setLiveMessage("terjadi error saat menghapus session.", "error");
        }
        return;
      }

      const pickButton = event.target.closest("[data-session-pick]");
      if (pickButton) {
        currentSessionId = pickButton.dataset.sessionPick || "";
        phoneDirty = false;
        closeAllMenus();
        renderSessionList(sessionList);
        await refreshStatus({ forcePhoneSync: true });
        const response = await fetch(`/api/dashboard/groups?sessionId=${encodeURIComponent(currentSessionId)}`, { headers: { Accept: "application/json" } });
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload.ok) renderControl(payload.data?.control);
      }
    });
  }

  if (pairingForm) {
    pairingForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const phone = phoneInput ? phoneInput.value.trim() : "";
      const sessionName = currentSessionId ? (nodes.selectedSessionName ? nodes.selectedSessionName.textContent.trim() : "") : "";
      try {
        setLiveMessage(null);
        setButtonLoading(submitButton, true, "meminta pairing...");
        const { response, payload } = await postJson("/api/pairing/request", {
          phone,
          sessionId: currentSessionId || null,
          sessionName
        });
        sessionList = payload.data?.sessions || sessionList;
        renderSessionList(sessionList);
        renderPairing(payload.data?.pairing, { forcePhoneSync: true });
        if (!response.ok || !payload.ok) {
          setLiveMessage(payload.message || "gagal meminta pairing code.", "error");
          return;
        }
        setLiveMessage(payload.message || "pairing code berhasil dibuat.", "success");
      } catch {
        setLiveMessage("terjadi error saat meminta pairing code.", "error");
      } finally {
        phoneDirty = false;
        setButtonLoading(submitButton, false);
        await refreshStatus({ forcePhoneSync: true });
      }
    });
  }

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".session-menu-wrap")) {
      closeAllMenus();
    }
  });

  window.addEventListener("resize", paintAllSessionCanvases);

  renderSessionList(sessionList);
  renderPairing(initialState?.selectedSession, { forcePhoneSync: true });
  renderControl(controlData);
  fetchInspector();
  refreshStatus();
  refreshControlData();
  setInterval(refreshStatus, 3000);
})();
  const setButtonLoading = (button, loading, label = "memproses...") => {
    if (!button) return;
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }
    button.disabled = loading;
    button.classList.toggle("is-loading", loading);
    button.setAttribute("aria-busy", loading ? "true" : "false");
    button.innerHTML = loading
      ? `<i class="fa-solid fa-spinner fa-spin"></i> ${label}`
      : button.dataset.originalHtml;
  };
