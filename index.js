/**
 * ======================================================
 * IMPORTS DAN KONFIGURASI AWAL
 * ======================================================
 */

require("./lib/function.js");
require("./config.js");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason,
  jidDecode,
  downloadContentFromMessage
} = require("@wanzofc1/Baileys");

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const express = require("express");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const bcrypt = require("bcryptjs");
const chalk = require("chalk");
const Pino = require("pino");
const cron = require("node-cron");

const DataBase = require("./lib/database.js");
const database = new DataBase();
const {
  HOST,
  PORT,
  SESSION_SECRET,
  connectDatabase,
  ensureInviteSeed,
  getStorageMode,
  getActiveMongoUri,
  webUsersRepo,
  inviteCodesRepo,
  pairingLogsRepo,
  botSessionsRepo
} = require("./db.js");
const {
  ensureSessionsRoot,
  createOrLoadSessionRecord,
  updateSessionRecord,
  clearSessionAuth
} = require("./lib/sessionStore.js");
const { imageToWebp, writeExifImg } = require("./lib/sticker.js");
const {
  ensureStoryStore,
  getGroupStoryTargets,
  sendStoryBatch
} = require("./lib/storyManager.js");
const serialize = require("./lib/serialize");

global.groupMetadataCache = global.groupMetadataCache || new Map();

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Rejection:", reason);
});

const runtimeSessions = new Map();
let dbPersistInterval = null;
let webServerStarted = false;
let autoJpmPrimarySessionId = null;
const baileysVersionPromise = fetchLatestBaileysVersion();

const sanitizePhoneNumber = (value = "") => String(value).replace(/[^\d]/g, "");
const nowIso = () => new Date().toISOString();
const rootMessagePath = path.join(__dirname, "message.js");
const rootListMenuPath = path.join(__dirname, "listmenu.js");
const cloudflareLogPath = path.join(__dirname, "database", "cloudflare_public.json");

function maskValue(value = "") {
  const text = String(value || "");
  if (!text || text === "-") return "-";
  if (text.length <= 4) return "*".repeat(text.length);
  const start = text.slice(0, 2);
  const end = text.slice(-2);
  return `${start}${"*".repeat(Math.max(2, text.length - 4))}${end}`;
}

function applyBotProfileSettings() {
  const profile = global.db?.config?.botProfile || {};
  global.owner = String(profile.ownerNumber || global.owner || "").replace(/[^\d]/g, "") || global.owner;
  global.namaOwner = profile.ownerName || global.namaOwner;
  global.botName = profile.botName || global.botName;
  global.thumbnail = profile.thumbnailMode === "upload"
    ? (profile.thumbnailUpload || profile.thumbnail || global.thumbnail)
    : (profile.thumbnail || global.thumbnail);
  global.thumbnailReply = profile.replyThumbnailMode === "upload"
    ? (profile.replyThumbnailUpload || profile.replyThumbnail || global.thumbnailReply)
    : (profile.replyThumbnail || global.thumbnailReply);
  global.footer = profile.footerText || global.footer || `powered by ${global.botName}`;
}

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function wantsJson(req) {
  const accept = String(req.headers.accept || "");
  const requestedWith = String(req.headers["x-requested-with"] || "");
  return accept.includes("application/json") || requestedWith.toLowerCase() === "xmlhttprequest";
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    setFlash(req, "error", "login dulu untuk membuka dashboard.");
    return res.redirect("/login");
  }
  next();
}

function redirectIfAuthenticated(req, res, next) {
  if (req.session.user) {
    return res.redirect("/dashboard");
  }
  next();
}

function normalizeSessionState(source = {}) {
  return {
    sessionId: source.sessionId || source.id || null,
    ownerId: source.ownerId || null,
    displayName: source.displayName || source.sessionName || "default",
    phone: sanitizePhoneNumber(source.phone || ""),
    isEnabled: source.isEnabled !== false,
    status: source.status || "idle",
    lastCode: source.lastCode || null,
    lastError: source.lastError || null,
    updatedAt: source.updatedAt || nowIso(),
    requestInFlight: Boolean(source.requestInFlight),
    connection: source.connection || "idle",
    registered: Boolean(source.registered),
    connectedJid: source.connectedJid || null,
    needsReauth: Boolean(source.needsReauth)
  };
}

function getOrCreateRuntime(record) {
  let runtime = runtimeSessions.get(record.id);
  if (runtime) {
    runtime.record = { ...runtime.record, ...record };
    return runtime;
  }

  runtime = {
    record,
    sock: null,
    startPromise: null,
    reconnectTimer: null,
    autoStoryTask: null,
    state: normalizeSessionState({
      sessionId: record.id,
      ownerId: record.ownerId,
      displayName: record.displayName,
      phone: record.phone,
      isEnabled: record.isEnabled,
      status: record.status,
      lastCode: record.lastCode,
      lastError: record.lastError,
      updatedAt: record.updatedAt,
      connection: record.connection || "idle",
      registered: record.registered,
      connectedJid: record.connectedJid,
      needsReauth: record.needsReauth
    })
  };

  runtimeSessions.set(record.id, runtime);
  return runtime;
}

function updateRuntimeState(runtime, patch = {}) {
  runtime.state = normalizeSessionState({
    ...runtime.state,
    ...patch,
    sessionId: runtime.record.id,
    ownerId: runtime.record.ownerId,
    displayName: runtime.record.displayName
  });

  updateSessionRecord(runtime.record.id, {
    phone: runtime.state.phone,
    isEnabled: runtime.state.isEnabled,
    status: runtime.state.status,
    lastCode: runtime.state.lastCode,
    lastError: runtime.state.lastError,
    updatedAt: runtime.state.updatedAt,
    connection: runtime.state.connection,
    registered: runtime.state.registered,
    connectedJid: runtime.state.connectedJid,
    needsReauth: runtime.state.needsReauth
  }).catch((error) => {
    console.error(`[Session:${runtime.record.id}] Gagal sinkron metadata session:`, error.message);
  });

  return runtime.state;
}

function getPublicSessionState(input) {
  if (!input) return normalizeSessionState();
  if (input.state) return normalizeSessionState(input.state);
  return normalizeSessionState(input);
}

function countMessageCases() {
  try {
    const fileContent = fs.readFileSync(path.join(__dirname, "message.js"), "utf8");
    const matches = fileContent.match(/case\s+["'`][^"'`]+["'`]\s*:/g) || [];
    return matches.length;
  } catch (error) {
    return 0;
  }
}

function getOverallPairingState() {
  const sessions = [...runtimeSessions.values()].map((runtime) => getPublicSessionState(runtime));
  if (!sessions.length) {
    return normalizeSessionState({
      status: "idle",
      connection: "idle",
      updatedAt: nowIso()
    });
  }

  const priority =
    sessions.find((session) => session.status === "connected") ||
    sessions.find((session) => session.status === "code_ready") ||
    sessions.find((session) => session.requestInFlight) ||
    sessions[0];

  return {
    ...priority,
    totalSessions: sessions.length
  };
}

function buildDashboardMetrics() {
  const storyRecords = global.db?.settings?.storyStore?.records || [];
  const users = Object.values(global.db?.users || {});
  return {
    totalUsers: users.length,
    totalRegisteredUsers: users.filter((user) => user?.registered).length,
    totalBannedChats: Object.values(global.db?.settings?.bannedChats || {}).filter(Boolean).length,
    totalGroups: Object.keys(global.db?.groups || {}).length,
    totalTransactions: Array.isArray(global.db?.transactions) ? global.db.transactions.length : 0,
    totalStories: storyRecords.length,
    totalSessions: runtimeSessions.size,
    totalCases: countMessageCases(),
    lastAutoStory: global.db?.settings?.autoStory?.lastRun || null
  };
}

function formatPairingError(error, reason = null) {
  const message =
    error?.output?.payload?.message ||
    error?.data?.message ||
    error?.message ||
    "Terjadi error saat meminta kode pairing.";

  const normalizedReason = Number(reason ?? error?.output?.statusCode ?? error?.output?.payload?.statusCode);

  if (normalizedReason === DisconnectReason.loggedOut || normalizedReason === 401) {
    return "Session logout atau expired. Pairing ulang diperlukan.";
  }
  if (/Connection Closed/i.test(message)) {
    return "Koneksi WhatsApp sedang tertutup. Tunggu socket hidup lalu coba lagi.";
  }
  if (/Precondition Required/i.test(message)) {
    return "Socket belum siap menerima pairing. Coba lagi beberapa detik lagi.";
  }
  if (/Connection Failure/i.test(message)) {
    return "Connection Failure";
  }

  return message;
}

async function writePairingLog(kind, payload = {}) {
  try {
    await pairingLogsRepo.create({
      kind,
      phone: payload.phone || null,
      status: payload.status || null,
      code: payload.code || null,
      error: payload.error || null,
      meta: payload.meta || {}
    });
  } catch (error) {
    console.error("[PairingLog] Gagal menyimpan log:", error.message);
  }
}

const loadDb = async () => {
  const load = (await database.read()) || {};
  global.db = {
    users: load.users || {},
    groups: load.groups || {},
    settings: {
      ...(load.settings || {}),
      owner: load.settings?.owner || [],
      self: load.settings?.self || false,
      autoAi: load.settings?.autoAi || false,
      list: load.settings?.list || {},
      stockDB: load.settings?.stockDB || { do: {}, script: {}, apps: {} },
      bljpm: load.settings?.bljpm || []
    },
    stock: load.stock || {},
    transactions: load.transactions || [],
    config: load.config || {}
  };

  if (!global.db.settings.autoStory) {
    global.db.settings.autoStory = {
      enabled: false,
      interval: "0 * * * *",
      message: null,
      lastRun: null
    };
  }

  if (!global.db.settings.autoJpm) {
    global.db.settings.autoJpm = {
      enabled: false,
      message: null,
      interval: 0
    };
  }

  ensureAnalyticsState();
  ensureDashboardConfig();

  applyBotProfileSettings();

  ensureStoryStore(global.db);
  await database.write(global.db);

  if (!dbPersistInterval) {
    dbPersistInterval = setInterval(async () => {
      await database.write(global.db);
    }, 3500);
  }
};

async function sendAutoStoryForRuntime(runtime) {
  const sock = runtime?.sock;
  if (!sock) return null;

  const autoStory = global.db.settings.autoStory;
  if (!autoStory || !autoStory.enabled) return null;

  const storyText = autoStory.message?.text;
  const media = autoStory.message?.media;
  if (!storyText && !media?.url) return null;

  try {
    const targets = await getGroupStoryTargets(sock, true);
    const result = await sendStoryBatch(sock, global.db, {
      targets,
      text: storyText || "",
      mediaType: media?.type || null,
      mediaUrl: media?.url || null,
      senderJid: sock.user?.id,
      source: `auto-story:${runtime.record.id}`,
      delayMs: 5000
    });

    global.db.settings.autoStory.lastRun = nowIso();
    return result;
  } catch (err) {
    console.error(`[AutoStory:${runtime.record.displayName}] Error:`, err);
    return null;
  }
}

function setupAutoStoryForRuntime(runtime) {
  if (runtime.autoStoryTask) {
    runtime.autoStoryTask.stop();
    runtime.autoStoryTask = null;
  }

  const cfg = global.db?.settings?.autoStory;
  const defaultInterval = "0 * * * *";
  const interval = typeof cfg?.interval === "string" ? cfg.interval.trim() : "";

  if (cfg && cfg.enabled && interval && !cron.validate(interval)) {
    cfg.interval = defaultInterval;
  }

  if (cfg && cfg.enabled && cfg.interval && runtime.sock && runtime.state.status === "connected") {
    runtime.autoStoryTask = cron.schedule(cfg.interval, async () => {
      await sendAutoStoryForRuntime(runtime);
    });
  }
}

function attachSocketHelpers(runtime) {
  if (!runtime.sock) return;
  runtime.sock.sessionId = runtime.record.id;
  runtime.sock.ownerId = runtime.record.ownerId;
  runtime.sock.sendAutoStory = () => sendAutoStoryForRuntime(runtime);
  runtime.sock.restartAutoStory = () => setupAutoStoryForRuntime(runtime);
  runtime.sock.getPairingState = () => getPublicSessionState(runtime);
}

function clearRuntimeReconnect(runtime) {
  if (runtime.reconnectTimer) {
    clearTimeout(runtime.reconnectTimer);
    runtime.reconnectTimer = null;
  }
}

function scheduleReconnect(runtime) {
  if (runtime.reconnectTimer || runtime.state.needsReauth || runtime.manualRestarting) return;

  runtime.reconnectTimer = setTimeout(() => {
    runtime.reconnectTimer = null;
    console.log(`[Session:${runtime.record.displayName}] Reconnecting...`);
    startSession(runtime.record).catch((error) => {
      console.error(`[Session:${runtime.record.displayName}] Gagal reconnect:`, error);
    });
  }, 3000);
}

async function stopSession(runtime, reason = "manual_stop") {
  if (!runtime) return;

  clearRuntimeReconnect(runtime);
  if (runtime.autoStoryTask) {
    clearInterval(runtime.autoStoryTask);
    runtime.autoStoryTask = null;
  }

  const sock = runtime.sock;
  runtime.sock = null;
  if (!sock) return;

  try {
    sock.ev?.removeAllListeners?.("messages.upsert");
    sock.ev?.removeAllListeners?.("connection.update");
    sock.ev?.removeAllListeners?.("creds.update");
    sock.ev?.removeAllListeners?.("group-participants.update");
  } catch (error) {
    console.error(`[Session:${runtime.record.displayName}] Gagal membersihkan listener:`, error.message);
  }

  try {
    if (typeof sock.end === "function") {
      sock.end(new Error(reason));
    } else if (typeof sock.ws?.close === "function") {
      sock.ws.close();
    } else if (typeof sock.logout === "function" && reason === "logout") {
      await sock.logout();
    }
  } catch (error) {
    console.error(`[Session:${runtime.record.displayName}] Gagal menghentikan socket:`, error.message);
  }
}

function buildCaseBlock(caseName, caseBody) {
  const safeName = String(caseName || "").trim().toLowerCase();
  const body = String(caseBody || "").replace(/\r\n/g, "\n").trim();
  if (!safeName) {
    throw new Error("nama case wajib diisi.");
  }
  if (!body) {
    throw new Error("isi case wajib diisi.");
  }
  if (!/^[a-z0-9_-]+$/.test(safeName)) {
    throw new Error("nama case hanya boleh huruf kecil, angka, strip, dan underscore.");
  }

  return `    case "${safeName}": {\n${body.split("\n").map((line) => `      ${line}`).join("\n")}\n    }\n      break;\n`;
}

function appendCaseToMessageFile(caseName, caseBody) {
  const source = fs.readFileSync(rootMessagePath, "utf8");
  const caseRegex = new RegExp(`case\\s+["'\`]${String(caseName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]\\s*:`);
  if (caseRegex.test(source)) {
    throw new Error("nama case sudah ada di message.js.");
  }

  const marker = "    default:\n      break;";
  if (!source.includes(marker)) {
    throw new Error("gagal menemukan blok default di message.js.");
  }

  const nextSource = source.replace(marker, `${buildCaseBlock(caseName, caseBody)}\n    default:\n      break;`);
  fs.writeFileSync(rootMessagePath, nextSource);
}

function checkJavascriptFile(filePath) {
  try {
    execFileSync(process.execPath, ["--check", filePath], {
      cwd: __dirname,
      stdio: "pipe"
    });
    return { ok: true, error: null };
  } catch (error) {
    const stderr = error?.stderr?.toString() || error?.stdout?.toString() || error?.message || "";
    const lineMatch = stderr.match(/:(\d+)\s*$/m) || stderr.match(/:(\d+):(\d+)/);
    return {
      ok: false,
      error: stderr.trim(),
      line: lineMatch ? Number(lineMatch[1]) : null
    };
  }
}

function extractBlockRange(source, startIndex) {
  let depth = 0;
  let seenOpening = false;
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
      seenOpening = true;
    } else if (char === "}") {
      depth -= 1;
      if (seenOpening && depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function getFullCaseBlock(source, caseName) {
  const regex = new RegExp(`case\\s+["'\`]${String(caseName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]\\s*:\\s*\\{`);
  const match = regex.exec(source);
  if (!match) return null;
  const blockStart = match.index;
  const braceIndex = source.indexOf("{", blockStart);
  const blockEnd = extractBlockRange(source, braceIndex);
  if (blockEnd === -1) return null;
  const breakMatch = /break\s*;/.exec(source.slice(blockEnd));
  const fullEnd = breakMatch ? blockEnd + breakMatch.index + breakMatch[0].length : blockEnd + 1;
  return source.slice(blockStart, fullEnd);
}

function getFullFunctionBlock(source, functionName) {
  const regexes = [
    new RegExp(`function\\s+${String(functionName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`),
    new RegExp(`const\\s+${String(functionName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*(async\\s*)?\\(`),
    new RegExp(`${String(functionName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*(async\\s*)?function\\s*\\(`)
  ];

  for (const regex of regexes) {
    const match = regex.exec(source);
    if (!match) continue;
    const braceIndex = source.indexOf("{", match.index);
    if (braceIndex === -1) continue;
    const blockEnd = extractBlockRange(source, braceIndex);
    if (blockEnd === -1) continue;
    return source.slice(match.index, blockEnd + 1);
  }

  return null;
}

function deleteNamedBlockFromMessage(kind, name) {
  const source = fs.readFileSync(rootMessagePath, "utf8");
  const block = kind === "function"
    ? getFullFunctionBlock(source, name)
    : getFullCaseBlock(source, name);

  if (!block) {
    throw new Error(`${kind} ${name} tidak ditemukan di message.js.`);
  }

  const next = source.replace(block, "");
  fs.writeFileSync(rootMessagePath, next);
}

function inspectMessageFile() {
  const source = fs.readFileSync(rootMessagePath, "utf8");
  const syntax = checkJavascriptFile(rootMessagePath);
  if (syntax.ok) {
    return {
      ok: true,
      error: null,
      line: null,
      caseBlock: null,
      functionBlock: null
    };
  }

  const lines = source.split("\n");
  const targetLine = syntax.line || 1;
  const targetIndex = lines.slice(0, Math.max(0, targetLine - 1)).join("\n").length;
  const caseMatches = [...source.matchAll(/case\s+["'`]([^"'`]+)["'`]\s*:\s*\{/g)];
  const functionMatches = [...source.matchAll(/function\s+([a-zA-Z0-9_]+)\s*\(|const\s+([a-zA-Z0-9_]+)\s*=\s*(?:async\s*)?\(/g)];

  const nearestCase = [...caseMatches].reverse().find((match) => match.index <= targetIndex);
  const nearestFunction = [...functionMatches].reverse().find((match) => match.index <= targetIndex);

  return {
    ok: false,
    error: syntax.error,
    line: syntax.line,
    caseBlock: nearestCase ? getFullCaseBlock(source, nearestCase[1]) : null,
    functionBlock: nearestFunction ? getFullFunctionBlock(source, nearestFunction[1] || nearestFunction[2]) : null
  };
}

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureDashboardConfig() {
  if (!global.db.config || typeof global.db.config !== "object") {
    global.db.config = {};
  }
  if (!global.db.config.dashboard || typeof global.db.config.dashboard !== "object") {
    global.db.config.dashboard = {};
  }
  if (!global.db.config.dashboard.publicUrl) global.db.config.dashboard.publicUrl = "";
  if (!global.db.config.dashboard.customDomain) global.db.config.dashboard.customDomain = "";
  if (typeof global.db.config.dashboard.maintenanceMode !== "boolean") {
    global.db.config.dashboard.maintenanceMode = false;
  }
  return global.db.config.dashboard;
}

function ensureAnalyticsState() {
  if (!global.db.settings || typeof global.db.settings !== "object") global.db.settings = {};
  if (!global.db.settings.commandStats || typeof global.db.settings.commandStats !== "object") {
    global.db.settings.commandStats = {};
  }
  return global.db.settings.commandStats;
}

function readCloudflarePublicInfo() {
  try {
    if (!fs.existsSync(cloudflareLogPath)) {
      return { url: ensureDashboardConfig().publicUrl || "", updatedAt: null };
    }
    const raw = JSON.parse(fs.readFileSync(cloudflareLogPath, "utf8"));
    return {
      url: String(raw.url || ensureDashboardConfig().publicUrl || ""),
      updatedAt: raw.updatedAt || null
    };
  } catch {
    return { url: ensureDashboardConfig().publicUrl || "", updatedAt: null };
  }
}

function writeCloudflarePublicInfo(url) {
  ensureDirectory(path.dirname(cloudflareLogPath));
  const payload = {
    url: String(url || ""),
    updatedAt: nowIso()
  };
  fs.writeFileSync(cloudflareLogPath, JSON.stringify(payload, null, 2));
  const dashboard = ensureDashboardConfig();
  dashboard.publicUrl = payload.url;
  return payload;
}

function normalizeComparableJid(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  const [userPart = ""] = text.split("@");
  const baseUser = userPart.split(":")[0];
  const digits = baseUser.replace(/\D/g, "");
  return digits || baseUser || text;
}

function isAdminParticipant(participant = {}) {
  const role = String(
    participant?.admin ??
    participant?.role ??
    participant?.participantRole ??
    ""
  ).toLowerCase();
  return ["admin", "superadmin", "super_admin"].includes(role);
}

async function getOwnedRuntime(ownerId, sessionId) {
  const record = await botSessionsRepo.findById(sessionId);
  if (!record || record.ownerId !== ownerId) {
    throw new Error("session tidak ditemukan atau bukan milik akun ini.");
  }
  const runtime = getOrCreateRuntime(record);
  runtime.record = record;
  if (!runtime.sock && record.isEnabled !== false) {
    await startSession(record, { forceResetAuth: false });
  }
  if (!runtime.sock) {
    throw new Error("session belum aktif atau socket belum siap.");
  }
  return runtime;
}

async function getGroupMetadataForRuntime(runtime, groupId) {
  const sock = runtime?.sock;
  if (!sock) throw new Error("socket session belum aktif.");
  const metadata = await sock.groupMetadata(groupId);
  global.groupMetadataCache.set(groupId, metadata);
  const participants = Array.isArray(metadata?.participants) ? metadata.participants : [];
  const adminJids = participants
    .filter(isAdminParticipant)
    .map((participant) => normalizeComparableJid(participant?.id || participant?.jid || participant?.participant || ""));
  const botJid = normalizeComparableJid(sock.user?.id || runtime.state.connectedJid || "");
  return {
    metadata,
    participants,
    adminJids,
    isBotAdmin: adminJids.includes(botJid)
  };
}

async function listGroupsForSession(ownerId, sessionId) {
  const runtime = await getOwnedRuntime(ownerId, sessionId);
  const groups = await runtime.sock.groupFetchAllParticipating();
  return Object.values(groups || {}).map((group) => {
    const groupState = global.db.groups?.[group.id] || {};
    const restrictedUsers = Object.entries(groupState.antilinkRestrictedUsers || {})
      .map(([jid, value]) => ({
        jid,
        until: value?.until || null,
        remainingMs: Math.max(0, Number(value?.until || 0) - Date.now())
      }))
      .filter((item) => item.until && item.remainingMs > 0);
    return {
      id: group.id,
      subject: group.subject || group.id,
      participantsCount: Array.isArray(group.participants) ? group.participants.length : 0,
      announce: Boolean(group.announce),
      restrict: Boolean(group.restrict),
      antilink: Boolean(groupState.antilink),
      antilink2: Boolean(groupState.antilink2),
      antilink3: Boolean(groupState.antilink3),
      welcome: Boolean(groupState.welcome),
      goodbye: Boolean(groupState.goodbye),
      bannedChat: Boolean(global.db.settings?.bannedChats?.[group.id]),
      warningCount: Object.keys(groupState.antilinkWarnings || {}).length,
      restrictedCount: restrictedUsers.length
    };
  }).sort((a, b) => a.subject.localeCompare(b.subject));
}

function buildUsersDataset() {
  const stats = ensureAnalyticsState();
  return Object.entries(global.db.users || {}).map(([jid, user]) => ({
    jid,
    number: normalizeComparableJid(jid),
    name: user?.name || "-",
    age: user?.age || "-",
    registered: Boolean(user?.registered),
    limit: Number(user?.limit || 0),
    banned: Boolean(user?.banned),
    totalBeli: Number(user?.totalBeli || 0),
    totalSpent: Number(user?.totalSpent || 0),
    commandCount: Number(stats[jid]?.count || 0),
    lastCommandAt: stats[jid]?.lastUsedAt || null,
    firstSeen: user?.firstSeen || null,
    lastSeen: user?.lastSeen || null
  })).sort((a, b) => (b.commandCount - a.commandCount) || (b.totalSpent - a.totalSpent));
}

function parseCsvRecords(raw = "") {
  const lines = String(raw || "").replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(",").map((item) => item.trim().toLowerCase());
  const rows = lines.slice(1);
  return rows.map((line) => {
    const columns = line.split(",").map((item) => item.trim());
    const row = {};
    header.forEach((key, index) => {
      row[key] = columns[index] || "";
    });
    return row;
  }).filter((row) => row.number || row.jid || row.name);
}

function ensureUserByJid(jid) {
  if (!global.db.users[jid] || typeof global.db.users[jid] !== "object") {
    global.db.users[jid] = {
      totalBeli: 0,
      totalSpent: 0,
      registered: false,
      name: "",
      age: "",
      limit: 10,
      banned: false,
      firstSeen: nowIso(),
      lastSeen: nowIso()
    };
  }
  return global.db.users[jid];
}

function resolveUserJidInput(input = "") {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (raw.includes("@")) return raw;
  const digits = sanitizePhoneNumber(raw);
  return digits ? `${digits}@s.whatsapp.net` : "";
}

function buildWarningsDataset() {
  return Object.entries(global.db.groups || {}).flatMap(([groupId, group]) => {
    const warnings = Object.entries(group?.antilinkWarnings || {}).map(([jid, count]) => {
      const restriction = group?.antilinkRestrictedUsers?.[jid] || null;
      const remainingMs = Math.max(0, Number(restriction?.until || 0) - Date.now());
      return {
        groupId,
        jid,
        count: Number(count || 0),
        restrictedUntil: restriction?.until || null,
        restrictionActive: Boolean(restriction?.until && remainingMs > 0),
        remainingMs
      };
    });
    return warnings;
  }).sort((a, b) => (b.count - a.count) || (b.remainingMs - a.remainingMs));
}

function getTemplateCases() {
  return [
    {
      id: "pingweb",
      name: "pingweb",
      title: "cek status web",
      body: 'Reply("dashboard web online dan route aktif.");'
    },
    {
      id: "cekuser",
      name: "cekuser",
      title: "cek user sendiri",
      body: 'const user = global.db.users[m.sender] || {};\nReply(`nama: ${user.name || "-"}\\nlimit: ${user.limit || 0}\\nregistered: ${user.registered ? "ya" : "tidak"}`);'
    },
    {
      id: "runtime",
      name: "runtime",
      title: "status runtime singkat",
      body: 'Reply(`bot: ${global.botName}\\nmode: ${global.db.settings.self ? "self" : "public"}\\nauto ai: ${global.db.settings.autoAi ? "on" : "off"}`);'
    }
  ];
}

function getSnippetLibrary() {
  return [
    { id: "owner-check", title: "owner check", code: 'if (!isOwner) return Reply(mess.owner);' },
    { id: "group-check", title: "group check", code: 'if (!m.isGroup) return Reply(mess.group);' },
    { id: "admin-check", title: "admin check", code: 'if (!isOwner && !m.isAdmin) return Reply(mess.admin);' },
    { id: "botadmin-check", title: "bot admin check", code: 'if (!m.isBotAdmin) return Reply(mess.botadmin);' },
    { id: "mention-target", title: "ambil target", code: 'const target = m.mentionedJid?.[0] || m.quoted?.sender || null;' }
  ];
}

function buildMenuPreview(title = "custom menu", commands = []) {
  const cleanTitle = String(title || "custom menu").trim().toLowerCase();
  const rows = commands.map((command) => `- .${String(command || "").trim().replace(/^\./, "")}`).filter(Boolean);
  return `*▨ ${cleanTitle}*\n${rows.join("\n")}`.trim();
}

function buildDashboardControlData(user, selectedSessionId = null, groups = null) {
  const dashboard = ensureDashboardConfig();
  const warnings = buildWarningsDataset();
  const users = buildUsersDataset();
  const commandStats = ensureAnalyticsState();
  return {
    users,
    leaderboard: users.slice(0, 10),
    commandStats: Object.entries(commandStats).map(([jid, value]) => ({
      jid,
      count: Number(value?.count || 0),
      lastUsedAt: value?.lastUsedAt || null
    })).sort((a, b) => b.count - a.count).slice(0, 25),
    warnings,
    punishments: warnings.filter((item) => item.restrictionActive),
    groups: groups || [],
    templates: getTemplateCases(),
    snippets: getSnippetLibrary(),
    cloudflare: readCloudflarePublicInfo(),
    dashboardSettings: {
      publicUrl: dashboard.publicUrl || "",
      customDomain: dashboard.customDomain || "",
      maintenanceMode: Boolean(dashboard.maintenanceMode)
    },
    botSettings: {
      autoAi: Boolean(global.db.settings?.autoAi),
      autoStory: global.db.settings?.autoStory || { enabled: false, interval: "0 * * * *", message: null, lastRun: null },
      autoJpm: global.db.settings?.autoJpm || { enabled: false, interval: 0, message: null },
      channelReact: global.db.settings?.channelReact || { sessions: {} }
    },
    selectedSessionId
  };
}

async function performGroupActionForSession(ownerId, { sessionId, groupId, action, target }) {
  const runtime = await getOwnedRuntime(ownerId, sessionId);
  const sock = runtime.sock;
  const { metadata, isBotAdmin } = await getGroupMetadataForRuntime(runtime, groupId);
  const targetJid = resolveUserJidInput(target);

  if (["open", "close", "promote", "demote"].includes(action) && !isBotAdmin) {
    throw new Error("bot belum terdeteksi sebagai admin grup.");
  }

  if (action === "leave") {
    await sock.groupLeave(groupId);
    return { ok: true };
  }
  if (action === "open") {
    await sock.groupSettingUpdate(groupId, "not_announcement");
    return { ok: true };
  }
  if (action === "close") {
    await sock.groupSettingUpdate(groupId, "announcement");
    return { ok: true };
  }
  if (action === "promote" || action === "demote") {
    if (!targetJid) throw new Error("target user wajib diisi.");
    await sock.groupParticipantsUpdate(groupId, [targetJid], action);
    return { ok: true };
  }
  if (action === "banchat") {
    global.db.settings.bannedChats = global.db.settings.bannedChats || {};
    global.db.settings.bannedChats[groupId] = true;
    return { ok: true };
  }
  if (action === "unbanchat") {
    global.db.settings.bannedChats = global.db.settings.bannedChats || {};
    delete global.db.settings.bannedChats[groupId];
    return { ok: true };
  }
  if (action === "unwarn") {
    const group = global.db.groups?.[groupId] || {};
    if (!targetJid) throw new Error("target user wajib diisi.");
    delete group.antilinkWarnings?.[targetJid];
    delete group.antilinkRestrictedUsers?.[targetJid];
    return { ok: true };
  }
  throw new Error("aksi grup tidak dikenal.");
}

async function startSession(record, options = {}) {
  const runtime = getOrCreateRuntime(record);
  if (runtime.startPromise) {
    return runtime.startPromise;
  }

  if (runtime.record.isEnabled === false && !options.ignoreEnabledState) {
    updateRuntimeState(runtime, {
      isEnabled: false,
      status: "offline",
      connection: "offline",
      requestInFlight: false,
      lastError: null
    });
    return runtime.sock;
  }

  runtime.startPromise = (async () => {
    if (options.forceResetAuth) {
      clearSessionAuth(record.authPath);
      updateRuntimeState(runtime, {
        isEnabled: true,
        status: "idle",
        connection: "idle",
        registered: false,
        connectedJid: null,
        lastCode: null,
        lastError: null,
        needsReauth: false
      });
    }

    const { state, saveCreds } = await useMultiFileAuthState(record.authPath);
    await baileysVersionPromise;

    const sock = makeWASocket({
      logger: Pino({ level: "silent" }),
      browser: Browsers.iOS("Safari"),
      auth: state,
      printQRInTerminal: false,
      cachedGroupMetadata: async (jid) => {
        if (!global.groupMetadataCache.has(jid)) {
          try {
            const metadata = await sock.groupMetadata(jid);
            global.groupMetadataCache.set(jid, metadata);
            return metadata;
          } catch (err) {
            console.error(`cachedGroupMetadata error for ${jid}:`, err.message);
            return null;
          }
        }
        return global.groupMetadataCache.get(jid);
      }
    });

    runtime.sock = sock;
    attachSocketHelpers(runtime);
    global.sock = sock;

    updateRuntimeState(runtime, {
      isEnabled: runtime.record.isEnabled !== false,
      connection: "connecting",
      registered: Boolean(sock.authState?.creds?.registered),
      connectedJid: sock.user?.id || null,
      status: Boolean(sock.authState?.creds?.registered) ? "idle" : runtime.state.status || "idle"
    });

    const sampahDir = "./sampah";
    if (!fs.existsSync(sampahDir)) fs.mkdirSync(sampahDir, { recursive: true });

    const autoJpm = require("./lib/autoJpm");
    if (!autoJpmPrimarySessionId || autoJpmPrimarySessionId === runtime.record.id) {
      autoJpmPrimarySessionId = runtime.record.id;
      autoJpm.setSocket(sock);
      autoJpm.start();
    }

    if (!sock.authState?.creds?.registered) {
      console.log(chalk.white(`[Pairing:${runtime.record.displayName}] Menunggu pairing dari dashboard.`));
      updateRuntimeState(runtime, {
        status: runtime.state.requestInFlight ? runtime.state.status : "idle",
        lastError: runtime.state.needsReauth ? "Session perlu pairing ulang." : null
      });
    }

    sock.ev.on("creds.update", async () => {
      await saveCreds();
      updateRuntimeState(runtime, {
        registered: Boolean(sock.authState?.creds?.registered),
        connectedJid: sock.user?.id || null
      });
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
      const msg = messages[0];
      if (!msg?.message) return;

      const m = await serialize(sock, msg);
      if (m.isBaileys) return;

      if (!m.key.fromMe && global.db.settings.autoread) {
        await sock.readMessages([m.key]);
      }

      require("./message.js")(sock, m);
    });

    sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
      if (connection) {
        updateRuntimeState(runtime, { connection });
      }

      if (connection === "close") {
        const reason = lastDisconnect?.error?.output?.statusCode;
        const requiresReauth = Number(reason) === 401 || reason === DisconnectReason.loggedOut;
        const errorMessage = formatPairingError(lastDisconnect?.error, reason);

        updateRuntimeState(runtime, {
          requestInFlight: false,
          status: requiresReauth ? "needs_pairing" : "idle",
          lastError: errorMessage,
          registered: false,
          connectedJid: null,
          needsReauth: requiresReauth
        });

        await writePairingLog("connection_closed", {
          phone: runtime.state.phone,
          status: requiresReauth ? "needs_pairing" : "idle",
          error: errorMessage,
          meta: {
            reason,
            sessionId: runtime.record.id,
            ownerId: runtime.record.ownerId
          }
        });

        if (requiresReauth) {
          console.log(`[Session:${runtime.record.displayName}] Connection closed (401). Pairing ulang diperlukan.`);
        } else {
          scheduleReconnect(runtime);
        }
      }

      if (connection === "open") {
        console.log(`[Session:${runtime.record.displayName}] Bot active!`);
        updateRuntimeState(runtime, {
          status: "connected",
          connection: "open",
          requestInFlight: false,
          lastError: null,
          registered: true,
          connectedJid: sock.user?.id || null,
          phone: runtime.state.phone || sanitizePhoneNumber(record.phone || ""),
          needsReauth: false
        });

        await writePairingLog("connected", {
          phone: runtime.state.phone,
          status: "connected",
          meta: {
            jid: sock.user?.id || null,
            sessionId: runtime.record.id,
            ownerId: runtime.record.ownerId
          }
        });

        setupAutoStoryForRuntime(runtime);
      }
    });

    sock.ev.on("group-participants.update", async (update) => {
      const { id, action, participants = [] } = update;
      try {
        const groupMetadata = await sock.groupMetadata(id);
        global.groupMetadataCache.set(id, groupMetadata);
        const groupState = global.db.groups?.[id] || {};
        if ((action === "add" && groupState.welcome) || (action === "remove" && groupState.goodbye)) {
          const mentions = participants
            .map((entry) => {
              if (typeof entry === "string") return entry;
              return entry?.id || entry?.jid || entry?.participant || entry?.lid || "";
            })
            .filter(Boolean);
          const text = action === "add"
            ? `selamat datang ${mentions.map((jid) => `@${normalizeComparableJid(jid)}`).join(", ")} di ${groupMetadata.subject || "grup"}.`
            : `sampai jumpa ${mentions.map((jid) => `@${normalizeComparableJid(jid)}`).join(", ")}.`;
          await sock.sendMessage(id, {
            text,
            mentions
          });
        }
      } catch (err) {
        console.error(`Gagal mengambil metadata grup ${id}:`, err.message);
        global.groupMetadataCache.delete(id);
      }
    });

    sock.downloadMediaMessage = async (m, type, filename = "") => {
      if (!m || !(m.url || m.directPath)) return Buffer.alloc(0);
      const stream = await downloadContentFromMessage(m, type);
      let buffer = Buffer.from([]);
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
      if (filename) await fs.promises.writeFile(filename, buffer);
      return filename && fs.existsSync(filename) ? filename : buffer;
    };

    sock.sendSticker = async (jid, stickerPath, quoted, options = {}) => {
      const buff = Buffer.isBuffer(stickerPath)
        ? stickerPath
        : /^data:.*?\/.*?;base64,/i.test(stickerPath)
          ? Buffer.from(stickerPath.split(",")[1], "base64")
          : /^https?:\/\//.test(stickerPath)
            ? await (await getBuffer(stickerPath))
            : fs.existsSync(stickerPath)
              ? fs.readFileSync(stickerPath)
              : Buffer.alloc(0);

      const buffer = (options.packname || options.author)
        ? await writeExifImg(buff, options)
        : await imageToWebp(buff);

      const tmpPath = `./sampah/${crypto.randomBytes(6).readUIntLE(0, 6).toString(36)}.webp`;
      fs.writeFileSync(tmpPath, buffer);
      await sock.sendMessage(jid, { sticker: { url: tmpPath }, ...options }, { quoted });
      fs.unlinkSync(tmpPath);
      return buffer;
    };

    sock.decodeJid = (jid) => {
      if (!jid) return jid;
      if (/:\d+@/gi.test(jid)) {
        const decode = jidDecode(jid) || {};
        return decode.user && decode.server ? `${decode.user}@${decode.server}` : jid;
      }
      return jid;
    };

    return sock;
  })();

  try {
    return await runtime.startPromise;
  } finally {
    runtime.startPromise = null;
  }
}

async function ensureOwnedSession(ownerId, sessionName, phone = "") {
  const record = await createOrLoadSessionRecord({
    ownerId,
    sessionName,
    phone
  });

  const runtime = getOrCreateRuntime(record);
  runtime.record = record;
  updateRuntimeState(runtime, {
    phone: phone || runtime.state.phone || ""
  });
  return runtime;
}

async function requestPairingCodeForSession({ ownerId, sessionId = null, sessionName = "", phone = "" }) {
  const normalizedPhone = sanitizePhoneNumber(phone);
  const nextSessionName = String(sessionName || "").trim() || `session-${normalizedPhone.slice(-4) || "baru"}`;

  let record = null;
  if (sessionId) {
    record = await botSessionsRepo.findById(sessionId);
    if (!record || record.ownerId !== ownerId) {
      throw new Error("Session tidak ditemukan atau bukan milik akun ini.");
    }
    if (normalizedPhone && normalizedPhone !== record.phone) {
      record = await updateSessionRecord(record.id, { phone: normalizedPhone });
    }
  } else {
    const runtime = await ensureOwnedSession(ownerId, nextSessionName, normalizedPhone);
    record = runtime.record;
  }

  const runtime = getOrCreateRuntime(record);
  if (runtime.record.isEnabled === false) {
    throw new Error("session sedang off. aktifkan dulu dari dashboard.");
  }
  if (runtime.state.requestInFlight) {
    return getPublicSessionState(runtime);
  }

  if (!runtime.sock || runtime.state.connection === "close" || runtime.state.needsReauth) {
    await startSession(runtime.record, { forceResetAuth: runtime.state.needsReauth });
    await new Promise((resolve) => setTimeout(resolve, 1800));
  }

  const sock = runtime.sock;
  if (!sock) throw new Error("Socket session belum siap.");

  if (sock.authState?.creds?.registered && runtime.state.registered) {
    updateRuntimeState(runtime, {
      phone: normalizedPhone || runtime.state.phone,
      status: "connected",
      lastError: null,
      requestInFlight: false
    });
    return getPublicSessionState(runtime);
  }

  updateRuntimeState(runtime, {
    phone: normalizedPhone || runtime.state.phone,
    status: "requesting",
    lastError: null,
    requestInFlight: true,
    lastCode: null,
    needsReauth: false
  });

  console.log(chalk.white(`[Pairing:${runtime.record.displayName}] Meminta kode pairing nomor WhatsApp +${normalizedPhone}...`));
  await writePairingLog("request_started", {
    phone: normalizedPhone,
    status: "requesting",
    meta: {
      sessionId: runtime.record.id,
      ownerId: runtime.record.ownerId
    }
  });

  try {
    const code = await sock.requestPairingCode(normalizedPhone, global.paircode);
    updateRuntimeState(runtime, {
      phone: normalizedPhone,
      status: "code_ready",
      lastCode: code,
      lastError: null,
      requestInFlight: false
    });

    console.log(chalk.white(`[Pairing:${runtime.record.displayName}] Kode Pairing: ${code}`));
    await writePairingLog("code_ready", {
      phone: normalizedPhone,
      status: "code_ready",
      code,
      meta: {
        sessionId: runtime.record.id,
        ownerId: runtime.record.ownerId
      }
    });

    return getPublicSessionState(runtime);
  } catch (error) {
    const formattedError = formatPairingError(error);
    updateRuntimeState(runtime, {
      phone: normalizedPhone,
      status: runtime.state.needsReauth ? "needs_pairing" : "error",
      lastError: formattedError,
      requestInFlight: false
    });

    await writePairingLog("request_failed", {
      phone: normalizedPhone,
      status: runtime.state.status,
      error: formattedError,
      meta: {
        sessionId: runtime.record.id,
        ownerId: runtime.record.ownerId
      }
    });

    throw error;
  }
}

async function restartOwnedSession(ownerId, sessionId) {
  const record = await botSessionsRepo.findById(sessionId);
  if (!record || record.ownerId !== ownerId) {
    throw new Error("Session tidak ditemukan atau bukan milik akun ini.");
  }

  const runtime = getOrCreateRuntime(record);
  runtime.record = record;
  runtime.manualRestarting = true;

  updateRuntimeState(runtime, {
    status: "restarting",
    connection: "restarting",
    requestInFlight: false,
    lastError: null
  });

  try {
    await stopSession(runtime, "manual_restart");
    await new Promise((resolve) => setTimeout(resolve, 800));
    await startSession(runtime.record, { forceResetAuth: false });
    return getPublicSessionState(runtime);
  } finally {
    runtime.manualRestarting = false;
  }
}

async function setOwnedSessionEnabled(ownerId, sessionId, isEnabled) {
  const record = await botSessionsRepo.findById(sessionId);
  if (!record || record.ownerId !== ownerId) {
    throw new Error("Session tidak ditemukan atau bukan milik akun ini.");
  }

  const runtime = getOrCreateRuntime(record);
  runtime.record = {
    ...runtime.record,
    ...record,
    isEnabled: Boolean(isEnabled)
  };

  await updateSessionRecord(record.id, { isEnabled: Boolean(isEnabled) });

  if (!isEnabled) {
    runtime.manualRestarting = true;
    try {
      await stopSession(runtime, "manual_offline");
      updateRuntimeState(runtime, {
        isEnabled: false,
        status: "offline",
        connection: "offline",
        registered: false,
        requestInFlight: false,
        lastError: null,
        connectedJid: null
      });
    } finally {
      runtime.manualRestarting = false;
    }
    return getPublicSessionState(runtime);
  }

  runtime.record.isEnabled = true;
  updateRuntimeState(runtime, {
    isEnabled: true,
    status: runtime.state.status === "offline" ? "idle" : runtime.state.status,
    connection: runtime.state.connection === "offline" ? "idle" : runtime.state.connection,
    lastError: null
  });
  await startSession(runtime.record, { ignoreEnabledState: true });
  return getPublicSessionState(runtime);
}

async function deleteOwnedSession(ownerId, sessionId) {
  const record = await botSessionsRepo.findById(sessionId);
  if (!record || record.ownerId !== ownerId) {
    throw new Error("Session tidak ditemukan atau bukan milik akun ini.");
  }

  const runtime = getOrCreateRuntime(record);
  runtime.manualRestarting = true;
  try {
    await stopSession(runtime, "manual_delete");
    if (fs.existsSync(record.authPath)) {
      fs.rmSync(record.authPath, { recursive: true, force: true });
    }
    runtimeSessions.delete(record.id);
    await botSessionsRepo.deleteById(record.id);
    return true;
  } finally {
    runtime.manualRestarting = false;
  }
}

async function listOwnerSessionsState(ownerId) {
  const records = await botSessionsRepo.listByOwner(ownerId);
  return records
    .map((record) => {
      const runtime = runtimeSessions.get(record.id);
      return getPublicSessionState(runtime || record);
    })
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
}

async function resolveOwnerSession(ownerId, preferredSessionId = null) {
  const sessions = await listOwnerSessionsState(ownerId);
  if (!sessions.length) return null;
  return sessions.find((session) => session.sessionId === preferredSessionId) || sessions[0];
}

async function buildDashboardViewModel(user, selectedSessionId = null) {
  const storyRecords = Array.isArray(global.db?.settings?.storyStore?.records)
    ? [...global.db.settings.storyStore.records].reverse().slice(0, 6)
    : [];

  const sessions = await listOwnerSessionsState(user.id);
  const selectedSession =
    sessions.find((session) => session.sessionId === selectedSessionId) ||
    sessions[0] ||
    null;

  const pairingEvents = selectedSession
    ? await pairingLogsRepo.listRecent(6, { sessionId: selectedSession.sessionId })
    : await pairingLogsRepo.listRecent(6, { ownerId: user.id });

  return {
    metrics: buildDashboardMetrics(),
    sessions,
    sessionsJson: JSON.stringify(sessions),
    selectedSession,
    selectedSessionJson: JSON.stringify(selectedSession),
    storyRecords,
    pairingEvents,
    controlData: buildDashboardControlData(user, selectedSession?.sessionId || null, [])
  };
}

function buildProfileViewModel(user) {
  const botProfile = global.db?.config?.botProfile || {};
  return {
    metrics: buildDashboardMetrics(),
    pairingState: getOverallPairingState(),
    profileSettings: {
      email: user?.email || "",
      username: user?.username || "",
      name: user?.name || "",
      avatarMode: user?.avatarMode || "link",
      avatarUrl: user?.avatarUrl || "",
      avatarUpload: user?.avatarUpload || "",
      botName: botProfile.botName || global.botName || "",
      ownerName: botProfile.ownerName || global.namaOwner || "",
      ownerNumber: botProfile.ownerNumber || global.owner || "",
      thumbnail: botProfile.thumbnail || global.thumbnail || "",
      thumbnailUpload: botProfile.thumbnailUpload || "",
      thumbnailMode: botProfile.thumbnailMode || "link",
      replyThumbnail: botProfile.replyThumbnail || global.thumbnailReply || "",
      replyThumbnailUpload: botProfile.replyThumbnailUpload || "",
      replyThumbnailMode: botProfile.replyThumbnailMode || "link",
      maskRuntimeHome: botProfile.maskRuntimeHome !== false,
      maskRuntimeAuth: botProfile.maskRuntimeAuth !== false,
      footerText: botProfile.footerText || global.footer || ""
    },
    messageInspector: inspectMessageFile()
  };
}

function createWebServer() {
  if (webServerStarted) return global.webApp;

  const app = express();
  global.webApp = app;
  const sessionConfig = {
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  };

  if (getStorageMode() === "mongo" && getActiveMongoUri()) {
    sessionConfig.store = MongoStore.create({
      mongoUrl: getActiveMongoUri(),
      collectionName: "web_sessions"
    });
  }

  app.disable("x-powered-by");
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));

  app.use("/assets", express.static(path.join(__dirname, "public")));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(session(sessionConfig));

  app.use((req, res, next) => {
    res.locals.brand = "wanzofc bot";
    res.locals.currentPath = req.path;
    res.locals.currentUser = req.session.user || null;
    res.locals.flash = req.session.flash || null;
    res.locals.pairingState = getOverallPairingState();
    res.locals.maskValue = maskValue;
    res.locals.botProfile = global.db?.config?.botProfile || {};
    delete req.session.flash;
    next();
  });

  app.use((req, res, next) => {
    const maintenanceMode = Boolean(global.db?.config?.dashboard?.maintenanceMode);
    if (!maintenanceMode) return next();
    const allowed =
      req.session.user ||
      req.path.startsWith("/api/") ||
      req.path.startsWith("/assets/") ||
      req.path === "/login" ||
      req.path === "/logout";
    if (allowed) return next();
    return res.status(503).send("maintenance mode aktif. login admin tetap diizinkan.");
  });

  app.get("/", (req, res) => {
    res.render("index", {
      pageTitle: "wanzofc bot",
      botStatus: getOverallPairingState(),
      metrics: buildDashboardMetrics()
    });
  });

  app.get("/login", redirectIfAuthenticated, (req, res) => {
    res.render("login", {
      pageTitle: "login",
      pairingState: getOverallPairingState(),
      metrics: buildDashboardMetrics()
    });
  });

  app.post("/login", redirectIfAuthenticated, async (req, res) => {
    try {
      const identifier = String(req.body.identifier || "").trim().toLowerCase();
      const password = String(req.body.password || "");

      if (!identifier || !password) {
        if (wantsJson(req)) {
          return res.status(400).json({ ok: false, message: "identifier dan password wajib diisi." });
        }
        setFlash(req, "error", "identifier dan password wajib diisi.");
        return res.redirect("/login");
      }

      const user = await webUsersRepo.findByIdentifier(identifier);
      if (!user || !user.isActive) {
        if (wantsJson(req)) {
          return res.status(400).json({ ok: false, message: "akun tidak ditemukan atau sudah nonaktif." });
        }
        setFlash(req, "error", "akun tidak ditemukan atau sudah nonaktif.");
        return res.redirect("/login");
      }

      const passwordMatch = await bcrypt.compare(password, user.passwordHash);
      if (!passwordMatch) {
        if (wantsJson(req)) {
          return res.status(400).json({ ok: false, message: "password yang kamu masukkan salah." });
        }
        setFlash(req, "error", "password yang kamu masukkan salah.");
        return res.redirect("/login");
      }

      req.session.user = {
        id: String(user._id),
        name: user.name,
        email: user.email,
        username: user.username,
        role: user.role
      };

      if (wantsJson(req)) {
        return res.json({ ok: true, redirectTo: "/dashboard" });
      }
      setFlash(req, "success", `halo ${user.name}, dashboard siap dipakai.`);
      return res.redirect("/dashboard");
    } catch (error) {
      console.error("[Web] Login error:", error);
      if (wantsJson(req)) {
        return res.status(500).json({ ok: false, message: "gagal login ke dashboard." });
      }
      setFlash(req, "error", "gagal login ke dashboard.");
      return res.redirect("/login");
    }
  });

  app.get("/register", redirectIfAuthenticated, (req, res) => {
    res.render("register", {
      pageTitle: "register",
      pairingState: getOverallPairingState(),
      metrics: buildDashboardMetrics()
    });
  });

  app.get("/profile", requireAuth, async (req, res) => {
    const latestUser = await webUsersRepo.findByIdentifier(req.session.user.email || req.session.user.username);
    const mergedUser = {
      ...req.session.user,
      ...(latestUser || {})
    };
    res.render("profile", {
      pageTitle: "profile",
      ...buildProfileViewModel(mergedUser)
    });
  });

  app.post("/register", redirectIfAuthenticated, async (req, res) => {
    try {
      const name = String(req.body.name || "").trim();
      const username = String(req.body.username || "").trim().toLowerCase();
      const email = String(req.body.email || "").trim().toLowerCase();
      const password = String(req.body.password || "");

      if (!name || !username || !email || !password) {
        if (wantsJson(req)) {
          return res.status(400).json({
            ok: false,
            message: "semua field register wajib diisi.",
            data: { received: { name, username, email, passwordFilled: Boolean(password) } }
          });
        }
        setFlash(req, "error", "semua field register wajib diisi.");
        return res.redirect("/register");
      }

      if (password.length < 6) {
        if (wantsJson(req)) {
          return res.status(400).json({ ok: false, message: "password minimal 6 karakter." });
        }
        setFlash(req, "error", "password minimal 6 karakter.");
        return res.redirect("/register");
      }

      const existingUser = await webUsersRepo.findByEmailOrUsername(email, username);
      if (existingUser) {
        if (wantsJson(req)) {
          return res.status(400).json({ ok: false, message: "email atau username sudah terdaftar." });
        }
        setFlash(req, "error", "email atau username sudah terdaftar.");
        return res.redirect("/register");
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const user = await webUsersRepo.create({
        name,
        username,
        email,
        passwordHash,
        role: "admin"
      });

      if (wantsJson(req)) {
        return res.json({ ok: true, redirectTo: "/login", message: "akun berhasil dibuat. sekarang login ke dashboard." });
      }
      setFlash(req, "success", "akun berhasil dibuat. sekarang login ke dashboard.");
      return res.redirect("/login");
    } catch (error) {
      console.error("[Web] Register error:", error);
      if (wantsJson(req)) {
        return res.status(500).json({ ok: false, message: "gagal membuat akun dashboard." });
      }
      setFlash(req, "error", "gagal membuat akun dashboard.");
      return res.redirect("/register");
    }
  });

  app.post("/logout", requireAuth, (req, res) => {
    req.session.destroy(() => {
      res.redirect("/login");
    });
  });

  app.get("/dashboard", requireAuth, async (req, res) => {
    const viewModel = await buildDashboardViewModel(req.session.user, req.query.sessionId || null);
    res.render("dashboard", {
      pageTitle: "dashboard",
      ...viewModel
    });
  });

  app.get("/api/sessions", requireAuth, async (req, res) => {
    const sessions = await listOwnerSessionsState(req.session.user.id);
    return res.json({ ok: true, data: sessions });
  });

  app.post("/api/sessions", requireAuth, async (req, res) => {
    try {
      const sessionName = String(req.body.sessionName || "").trim();
      const phone = sanitizePhoneNumber(req.body.phone || "");
      if (!sessionName) {
        return res.status(400).json({ ok: false, message: "nama session wajib diisi." });
      }

      const runtime = await ensureOwnedSession(req.session.user.id, sessionName, phone);
      await startSession(runtime.record);

      return res.json({
        ok: true,
        message: `session ${runtime.record.displayName} siap dipakai.`,
        data: {
          session: getPublicSessionState(runtime),
          sessions: await listOwnerSessionsState(req.session.user.id)
        }
      });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        message: error?.message || "gagal membuat session."
      });
    }
  });

  app.post("/profile", requireAuth, async (req, res) => {
    try {
      const email = String(req.body.email || "").trim().toLowerCase();
      const username = String(req.body.username || "").trim().toLowerCase();
      const name = String(req.body.name || "").trim();
      const password = String(req.body.password || "");
      const avatarMode = String(req.body.avatarMode || "link").trim().toLowerCase();
      const avatarUrl = String(req.body.avatarUrl || "").trim();
      const avatarUpload = String(req.body.avatarUpload || "").trim();

      const botProfilePatch = {
        botName: String(req.body.botName || "").trim() || global.botName,
        ownerName: String(req.body.ownerName || "").trim() || global.namaOwner,
        ownerNumber: sanitizePhoneNumber(req.body.ownerNumber || global.owner),
        thumbnailMode: String(req.body.thumbnailMode || "link").trim().toLowerCase(),
        thumbnail: String(req.body.thumbnail || "").trim() || global.thumbnail,
        thumbnailUpload: String(req.body.thumbnailUpload || "").trim(),
        replyThumbnailMode: String(req.body.replyThumbnailMode || "link").trim().toLowerCase(),
        replyThumbnail: String(req.body.replyThumbnail || "").trim() || global.thumbnailReply,
        replyThumbnailUpload: String(req.body.replyThumbnailUpload || "").trim(),
        maskRuntimeHome: req.body.maskRuntimeHome === "on",
        maskRuntimeAuth: req.body.maskRuntimeAuth === "on",
        footerText: String(req.body.footerText || "").trim()
      };

      if (!email || !username || !name) {
        setFlash(req, "error", "nama, username, dan email wajib diisi.");
        return res.redirect("/profile");
      }

      const existing = await webUsersRepo.findByEmailOrUsername(email, username);
      const currentId = String(req.session.user.id || req.session.user._id);
      if (existing && String(existing._id) !== currentId) {
        setFlash(req, "error", "email atau username sudah dipakai akun lain.");
        return res.redirect("/profile");
      }

      const patch = {
        email,
        username,
        name,
        avatarMode,
        avatarUrl,
        avatarUpload
      };

      if (password) {
        if (password.length < 6) {
          setFlash(req, "error", "password minimal 6 karakter.");
          return res.redirect("/profile");
        }
        patch.passwordHash = await bcrypt.hash(password, 10);
      }

      const updatedUser = await webUsersRepo.updateById(currentId, patch);
      global.db.config.botProfile = {
        ...(global.db.config.botProfile || {}),
        ...botProfilePatch
      };
      applyBotProfileSettings();

      req.session.user = {
        id: updatedUser?._id || currentId,
        email,
        username,
        name,
        role: req.session.user.role
      };

      setFlash(req, "success", "profile dan pengaturan bot berhasil diperbarui.");
      return res.redirect("/profile");
    } catch (error) {
      console.error("[Web] Profile update error:", error);
      setFlash(req, "error", error?.message || "gagal memperbarui profile.");
      return res.redirect("/profile");
    }
  });

  app.get("/api/pairing/status", requireAuth, async (req, res) => {
    const selectedSession = await resolveOwnerSession(req.session.user.id, req.query.sessionId || null);
    return res.json({
      ok: true,
      data: {
        pairing: selectedSession,
        metrics: buildDashboardMetrics(),
        sessions: await listOwnerSessionsState(req.session.user.id)
      }
    });
  });

  app.post("/api/pairing/request", requireAuth, async (req, res) => {
    try {
      const phone = sanitizePhoneNumber(req.body.phone || "");
      const sessionId = String(req.body.sessionId || "").trim() || null;
      const sessionName = String(req.body.sessionName || "").trim();

      if (!phone) {
        return res.status(400).json({
          ok: false,
          message: "nomor WhatsApp wajib diisi."
        });
      }

      const state = await requestPairingCodeForSession({
        ownerId: req.session.user.id,
        sessionId,
        sessionName,
        phone
      });

      return res.json({
        ok: true,
        message: state.lastCode
          ? "kode pairing berhasil dibuat."
          : "permintaan pairing diterima.",
        data: {
          pairing: state,
          sessions: await listOwnerSessionsState(req.session.user.id)
        }
      });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        message: formatPairingError(error),
        data: {
          sessions: await listOwnerSessionsState(req.session.user.id)
        }
      });
    }
  });

  app.post("/api/sessions/:sessionId/restart", requireAuth, async (req, res) => {
    try {
      const sessionId = String(req.params.sessionId || "").trim();
      if (!sessionId) {
        return res.status(400).json({
          ok: false,
          message: "sessionId wajib ada."
        });
      }

      const state = await restartOwnedSession(req.session.user.id, sessionId);
      return res.json({
        ok: true,
        message: `session ${state.displayName || sessionId} sedang direstart.`,
        data: {
          pairing: state,
          metrics: buildDashboardMetrics(),
          sessions: await listOwnerSessionsState(req.session.user.id)
        }
      });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        message: error?.message || "gagal restart session.",
        data: {
          metrics: buildDashboardMetrics(),
          sessions: await listOwnerSessionsState(req.session.user.id)
        }
      });
    }
  });

  app.post("/api/sessions/:sessionId/power", requireAuth, async (req, res) => {
    try {
      const sessionId = String(req.params.sessionId || "").trim();
      const mode = String(req.body.mode || "").trim().toLowerCase();
      if (!sessionId) {
        return res.status(400).json({ ok: false, message: "sessionId wajib ada." });
      }
      if (!["active", "off"].includes(mode)) {
        return res.status(400).json({ ok: false, message: "mode harus active atau off." });
      }

      const state = await setOwnedSessionEnabled(req.session.user.id, sessionId, mode === "active");
      return res.json({
        ok: true,
        message: mode === "active"
          ? `session ${state.displayName || sessionId} diaktifkan.`
          : `session ${state.displayName || sessionId} dimatikan.`,
        data: {
          pairing: state,
          metrics: buildDashboardMetrics(),
          sessions: await listOwnerSessionsState(req.session.user.id)
        }
      });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        message: error?.message || "gagal mengubah status session.",
        data: {
          metrics: buildDashboardMetrics(),
          sessions: await listOwnerSessionsState(req.session.user.id)
        }
      });
    }
  });

  app.post("/api/message/cases", requireAuth, async (req, res) => {
    try {
      const caseName = String(req.body.caseName || "").trim().toLowerCase();
      const caseBody = String(req.body.caseBody || "");
      appendCaseToMessageFile(caseName, caseBody);
      const inspection = inspectMessageFile();
      if (!inspection.ok) {
        deleteNamedBlockFromMessage("case", caseName);
        return res.status(400).json({
          ok: false,
          message: "case ditolak karena menyebabkan error syntax. periksa blok penuh di inspector.",
          data: {
            metrics: buildDashboardMetrics(),
            inspector: inspection
          }
        });
      }

      return res.json({
        ok: true,
        message: `case ${caseName} berhasil ditambahkan ke message.js.`,
        data: {
          metrics: buildDashboardMetrics()
        }
      });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        message: error?.message || "gagal menambah case ke message.js.",
        data: {
          metrics: buildDashboardMetrics()
        }
      });
    }
  });

  app.delete("/api/sessions/:sessionId", requireAuth, async (req, res) => {
    try {
      const sessionId = String(req.params.sessionId || "").trim();
      await deleteOwnedSession(req.session.user.id, sessionId);
      return res.json({
        ok: true,
        message: "session berhasil dihapus.",
        data: {
          metrics: buildDashboardMetrics(),
          sessions: await listOwnerSessionsState(req.session.user.id)
        }
      });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        message: error?.message || "gagal menghapus session.",
        data: {
          metrics: buildDashboardMetrics(),
          sessions: await listOwnerSessionsState(req.session.user.id)
        }
      });
    }
  });

  app.get("/api/message/inspect", requireAuth, async (req, res) => {
    return res.json({
      ok: true,
      data: {
        inspector: inspectMessageFile(),
        metrics: buildDashboardMetrics()
      }
    });
  });

  app.post("/api/message/cases/delete", requireAuth, async (req, res) => {
    try {
      const caseName = String(req.body.caseName || "").trim().toLowerCase();
      if (!caseName) {
        return res.status(400).json({ ok: false, message: "nama case wajib diisi." });
      }
      deleteNamedBlockFromMessage("case", caseName);
      return res.json({
        ok: true,
        message: `case ${caseName} berhasil dihapus.`,
        data: {
          metrics: buildDashboardMetrics(),
          inspector: inspectMessageFile()
        }
      });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        message: error?.message || "gagal menghapus case.",
        data: {
          inspector: inspectMessageFile()
        }
      });
    }
  });

  app.post("/api/message/functions/delete", requireAuth, async (req, res) => {
    try {
      const functionName = String(req.body.functionName || "").trim();
      if (!functionName) {
        return res.status(400).json({ ok: false, message: "nama function wajib diisi." });
      }
      deleteNamedBlockFromMessage("function", functionName);
      return res.json({
        ok: true,
        message: `function ${functionName} berhasil dihapus.`,
        data: {
          metrics: buildDashboardMetrics(),
          inspector: inspectMessageFile()
        }
      });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        message: error?.message || "gagal menghapus function.",
        data: {
          inspector: inspectMessageFile()
        }
      });
    }
  });

  app.get("/api/dashboard/control-data", requireAuth, async (req, res) => {
    const sessionId = String(req.query.sessionId || "").trim() || null;
    let groups = [];
    if (sessionId) {
      try {
        groups = await listGroupsForSession(req.session.user.id, sessionId);
      } catch {}
    }
    return res.json({
      ok: true,
      data: {
        metrics: buildDashboardMetrics(),
        control: buildDashboardControlData(req.session.user, sessionId, groups)
      }
    });
  });

  app.post("/api/dashboard/users/import-csv", requireAuth, async (req, res) => {
    try {
      const csv = String(req.body.csv || "");
      const rows = parseCsvRecords(csv);
      if (!rows.length) {
        return res.status(400).json({ ok: false, message: "csv user kosong atau format tidak terbaca." });
      }
      let imported = 0;
      for (const row of rows) {
        const jid = resolveUserJidInput(row.jid || row.number || row.nomor || row.phone);
        if (!jid) continue;
        const user = ensureUserByJid(jid);
        user.name = row.name || row.nama || user.name || "";
        user.age = row.age || row.umur || user.age || "";
        if (row.limit) user.limit = Number(row.limit) || user.limit || 10;
        if (row.registered) user.registered = ["true", "1", "yes", "ya"].includes(String(row.registered).toLowerCase());
        imported += 1;
      }
      return res.json({
        ok: true,
        message: `${imported} user dari csv berhasil diimport.`,
        data: {
          control: buildDashboardControlData(req.session.user)
        }
      });
    } catch (error) {
      return res.status(400).json({ ok: false, message: error?.message || "gagal import csv user." });
    }
  });

  app.post("/api/dashboard/users/action", requireAuth, async (req, res) => {
    try {
      const action = String(req.body.action || "").trim().toLowerCase();
      const target = String(req.body.target || "").trim();
      const amount = Number(req.body.amount || 0);
      const userJid = resolveUserJidInput(target);
      if (["ban", "unban", "resetlimit"].includes(action) && !userJid) {
        return res.status(400).json({ ok: false, message: "target user wajib diisi." });
      }
      if (action === "masslimit" && !Number.isFinite(amount)) {
        return res.status(400).json({ ok: false, message: "jumlah limit massal wajib angka." });
      }

      if (action === "ban") ensureUserByJid(userJid).banned = true;
      else if (action === "unban") ensureUserByJid(userJid).banned = false;
      else if (action === "resetlimit") ensureUserByJid(userJid).limit = 10;
      else if (action === "masslimit") {
        for (const jid of Object.keys(global.db.users || {})) {
          ensureUserByJid(jid).limit = Number(ensureUserByJid(jid).limit || 0) + amount;
        }
      } else {
        return res.status(400).json({ ok: false, message: "aksi user tidak dikenal." });
      }

      return res.json({
        ok: true,
        message: "aksi user berhasil dijalankan.",
        data: {
          control: buildDashboardControlData(req.session.user)
        }
      });
    } catch (error) {
      return res.status(400).json({ ok: false, message: error?.message || "gagal menjalankan aksi user." });
    }
  });

  app.get("/api/dashboard/groups", requireAuth, async (req, res) => {
    try {
      const sessionId = String(req.query.sessionId || "").trim();
      if (!sessionId) {
        return res.status(400).json({ ok: false, message: "session wajib dipilih." });
      }
      const groups = await listGroupsForSession(req.session.user.id, sessionId);
      return res.json({
        ok: true,
        data: {
          groups,
          control: buildDashboardControlData(req.session.user, sessionId, groups)
        }
      });
    } catch (error) {
      return res.status(400).json({ ok: false, message: error?.message || "gagal memuat grup session." });
    }
  });

  app.post("/api/dashboard/groups/settings", requireAuth, async (req, res) => {
    try {
      const groupId = String(req.body.groupId || "").trim();
      const key = String(req.body.key || "").trim();
      const value = req.body.value;
      if (!groupId || !key) {
        return res.status(400).json({ ok: false, message: "groupId dan key wajib diisi." });
      }
      if (!global.db.groups[groupId]) global.db.groups[groupId] = {};
      global.db.groups[groupId][key] = value;
      return res.json({
        ok: true,
        message: `setting grup ${key} berhasil diupdate.`,
        data: {
          control: buildDashboardControlData(req.session.user)
        }
      });
    } catch (error) {
      return res.status(400).json({ ok: false, message: error?.message || "gagal mengubah setting grup." });
    }
  });

  app.post("/api/dashboard/groups/action", requireAuth, async (req, res) => {
    try {
      const sessionId = String(req.body.sessionId || "").trim();
      const groupId = String(req.body.groupId || "").trim();
      const action = String(req.body.action || "").trim().toLowerCase();
      const target = String(req.body.target || "").trim();
      if (!sessionId || !groupId || !action) {
        return res.status(400).json({ ok: false, message: "session, group, dan action wajib diisi." });
      }
      await performGroupActionForSession(req.session.user.id, { sessionId, groupId, action, target });
      const groups = await listGroupsForSession(req.session.user.id, sessionId);
      return res.json({
        ok: true,
        message: `aksi grup ${action} berhasil dijalankan.`,
        data: {
          groups,
          control: buildDashboardControlData(req.session.user, sessionId, groups)
        }
      });
    } catch (error) {
      return res.status(400).json({ ok: false, message: error?.message || "gagal menjalankan aksi grup." });
    }
  });

  app.post("/api/dashboard/settings", requireAuth, async (req, res) => {
    try {
      const action = String(req.body.action || "").trim().toLowerCase();
      const payload = req.body.payload || {};
      const dashboard = ensureDashboardConfig();
      if (action === "autoai") {
        global.db.settings.autoAi = Boolean(payload.enabled);
      } else if (action === "autostory") {
        global.db.settings.autoStory = {
          ...(global.db.settings.autoStory || {}),
          enabled: Boolean(payload.enabled),
          interval: String(payload.interval || global.db.settings.autoStory?.interval || "0 * * * *"),
          message: {
            text: String(payload.text || global.db.settings.autoStory?.message?.text || ""),
            media: payload.mediaUrl ? { url: String(payload.mediaUrl), type: String(payload.mediaType || "image") } : (global.db.settings.autoStory?.message?.media || null)
          }
        };
        runtimeSessions.forEach((runtime) => runtime.sock?.restartAutoStory?.());
      } else if (action === "autojpm") {
        global.db.settings.autoJpm = {
          ...(global.db.settings.autoJpm || {}),
          enabled: Boolean(payload.enabled),
          interval: Math.max(0, Number(payload.intervalMs || global.db.settings.autoJpm?.interval || 0)),
          message: {
            text: String(payload.text || global.db.settings.autoJpm?.message?.text || ""),
            media: payload.mediaUrl ? { url: String(payload.mediaUrl), type: String(payload.mediaType || "image") } : (global.db.settings.autoJpm?.message?.media || null)
          }
        };
        const autoJpm = require("./lib/autoJpm");
        if (global.db.settings.autoJpm.enabled) autoJpm.start();
        else autoJpm.stop();
      } else if (action === "channelreact") {
        global.db.settings.channelReact = global.db.settings.channelReact || { sessions: {} };
        global.db.settings.channelReact.dashboardDefaults = {
          emoji: String(payload.emoji || ""),
          count: Number(payload.count || 1),
          link: String(payload.link || "")
        };
      } else if (action === "dashboard") {
        dashboard.publicUrl = String(payload.publicUrl || dashboard.publicUrl || "");
        dashboard.customDomain = String(payload.customDomain || dashboard.customDomain || "");
        dashboard.maintenanceMode = Boolean(payload.maintenanceMode);
        if (payload.publicUrl) writeCloudflarePublicInfo(payload.publicUrl);
      } else {
        return res.status(400).json({ ok: false, message: "aksi setting tidak dikenal." });
      }
      return res.json({
        ok: true,
        message: "setting dashboard berhasil diperbarui.",
        data: {
          control: buildDashboardControlData(req.session.user)
        }
      });
    } catch (error) {
      return res.status(400).json({ ok: false, message: error?.message || "gagal menyimpan setting dashboard." });
    }
  });

  app.post("/api/dashboard/menu/preview", requireAuth, async (req, res) => {
    try {
      const title = String(req.body.title || "custom menu");
      const commands = Array.isArray(req.body.commands) ? req.body.commands : String(req.body.commands || "").split(",").map((item) => item.trim()).filter(Boolean);
      return res.json({
        ok: true,
        data: {
          preview: buildMenuPreview(title, commands)
        }
      });
    } catch (error) {
      return res.status(400).json({ ok: false, message: error?.message || "gagal membuat preview menu." });
    }
  });

  app.post("/api/dashboard/templates/apply", requireAuth, async (req, res) => {
    try {
      const templateId = String(req.body.templateId || "").trim();
      const template = getTemplateCases().find((item) => item.id === templateId);
      if (!template) return res.status(404).json({ ok: false, message: "template case tidak ditemukan." });
      appendCaseToMessageFile(template.name, template.body);
      const inspection = inspectMessageFile();
      if (!inspection.ok) {
        deleteNamedBlockFromMessage("case", template.name);
        return res.status(400).json({ ok: false, message: "template menyebabkan syntax error.", data: { inspector: inspection } });
      }
      return res.json({
        ok: true,
        message: `template case ${template.title} berhasil dipasang.`,
        data: {
          inspector: inspection,
          control: buildDashboardControlData(req.session.user)
        }
      });
    } catch (error) {
      return res.status(400).json({ ok: false, message: error?.message || "gagal menerapkan template case." });
    }
  });

  if (!process.env.VERCEL) {
    app.listen(PORT, HOST, () => {
      webServerStarted = true;
      console.log(`[Web] Dashboard aktif di http://127.0.0.1:${PORT}`);
      console.log(`[Web] Bind host: http://${HOST}:${PORT}`);
      console.log(`[Web] Storage mode: ${getStorageMode()}`);
      console.log(`[Web] Sessions root: ${ensureSessionsRoot()}`);
    });
  } else {
    webServerStarted = true;
  }

  return app;
}

if (process.env.VERCEL && !global.webApp) {
  module.exports = createWebServer();
}

async function bootstrap() {
  await connectDatabase();
  await ensureInviteSeed();
  ensureSessionsRoot();
  await loadDb();
  createWebServer();

  const sessionRecords = await botSessionsRepo.listAll();
  for (const record of sessionRecords) {
    if (record.isEnabled === false) {
      const runtime = getOrCreateRuntime(record);
      updateRuntimeState(runtime, {
        isEnabled: false,
        status: "offline",
        connection: "offline",
        registered: false,
        connectedJid: null,
        requestInFlight: false
      });
      continue;
    }

    if (record.needsReauth || record.status === "needs_pairing") {
      getOrCreateRuntime(record);
      continue;
    }
    await startSession(record);
  }
}

bootstrap().catch((error) => {
  console.error("[Bootstrap] Gagal menjalankan bot + dashboard:", error);
  process.exit(1);
});
