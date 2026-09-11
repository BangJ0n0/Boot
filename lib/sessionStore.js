const fs = require("fs");
const path = require("path");
const { botSessionsRepo } = require("../db.js");

const SESSIONS_ROOT = path.join(__dirname, "..", "sessions");

function ensureSessionsRoot() {
  if (!fs.existsSync(SESSIONS_ROOT)) {
    fs.mkdirSync(SESSIONS_ROOT, { recursive: true });
  }
  return SESSIONS_ROOT;
}

function sanitizeSessionPart(value = "", fallback = "session") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || fallback;
}

function buildSessionId(ownerId, sessionName) {
  const ownerPart = sanitizeSessionPart(ownerId, "owner");
  const sessionPart = sanitizeSessionPart(sessionName, "default");
  return `${ownerPart}__${sessionPart}`;
}

function resolveSessionPath(sessionId) {
  ensureSessionsRoot();
  return path.join(SESSIONS_ROOT, sessionId);
}

async function createOrLoadSessionRecord({ ownerId, sessionName, phone = "" }) {
  const id = buildSessionId(ownerId, sessionName);
  const existing = await botSessionsRepo.findById(id);
  const authPath = resolveSessionPath(id);

  if (!fs.existsSync(authPath)) {
    fs.mkdirSync(authPath, { recursive: true });
  }

  const baseRecord = {
    id,
    ownerId,
    sessionName: sanitizeSessionPart(sessionName, "default"),
    displayName: String(sessionName || "default").trim() || "default",
    phone,
    authPath,
    isEnabled: existing?.isEnabled !== false,
    status: "idle",
    connection: "idle",
    registered: false,
    connectedJid: null
  };

  if (existing) {
    return botSessionsRepo.upsert({
      ...existing,
      phone: phone || existing.phone || "",
      isEnabled: existing.isEnabled !== false,
      authPath
    });
  }

  return botSessionsRepo.upsert(baseRecord);
}

async function updateSessionRecord(sessionId, patch = {}) {
  const existing = await botSessionsRepo.findById(sessionId);
  if (!existing) return null;
  return botSessionsRepo.upsert({
    ...existing,
    ...patch
  });
}

function clearSessionAuth(authPath) {
  const sessionsRoot = ensureSessionsRoot();
  const resolved = path.resolve(authPath);
  if (!resolved.startsWith(path.resolve(sessionsRoot))) {
    throw new Error("Auth path di luar folder sessions.");
  }

  if (fs.existsSync(resolved)) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  fs.mkdirSync(resolved, { recursive: true });
}

module.exports = {
  SESSIONS_ROOT,
  ensureSessionsRoot,
  sanitizeSessionPart,
  buildSessionId,
  resolveSessionPath,
  createOrLoadSessionRecord,
  updateSessionRecord,
  clearSessionAuth
};
