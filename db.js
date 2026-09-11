const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mongoose = require("mongoose");

const HOST = "0.0.0.0";
const PORT = 3000;
const PRIMARY_MONGO_URI = "mongodb+srv://wuploadcloud_db_user:sq8TwuX9H9jl25a6@cluster0.jzp6pzl.mongodb.net/wanzofc?appName=Cluster0";
const FALLBACK_MONGO_URI = "mongodb://127.0.0.1:27017/wanzofc-bot";
const MONGO_URI = PRIMARY_MONGO_URI;
const SESSION_SECRET = "wanzofc-bot-dashboard-secret";
const DEFAULT_INVITE_CODE = "WANZOFC-ADMIN";
const LEGACY_JSON_PATH = path.join(__dirname, "database", "database.json");
const WEB_USERS_PATH = path.join(__dirname, "database", "web_users.json");
const INVITE_CODES_PATH = path.join(__dirname, "database", "invite_codes.json");
const PAIRING_LOGS_PATH = path.join(__dirname, "database", "pairing_logs.json");
const BOT_SESSIONS_PATH = path.join(__dirname, "database", "bot_sessions.json");

const { Schema } = mongoose;

const botStateSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: "main" },
    data: { type: Schema.Types.Mixed, default: {} }
  },
  {
    minimize: false,
    timestamps: true
  }
);

const webUserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    avatarMode: { type: String, default: "link" },
    avatarUrl: { type: String, default: "" },
    avatarUpload: { type: String, default: "" },
    role: { type: String, default: "admin" },
    isActive: { type: Boolean, default: true }
  },
  {
    timestamps: true
  }
);

const inviteCodeSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    label: { type: String, default: "default invite" },
    isActive: { type: Boolean, default: true },
    createdBy: { type: String, default: "system" },
    usedBy: { type: Schema.Types.ObjectId, ref: "WebUser", default: null },
    usedAt: { type: Date, default: null }
  },
  {
    timestamps: true
  }
);

const pairingLogSchema = new Schema(
  {
    kind: { type: String, required: true },
    phone: { type: String, default: null },
    status: { type: String, default: null },
    code: { type: String, default: null },
    error: { type: String, default: null },
    meta: { type: Schema.Types.Mixed, default: {} }
  },
  {
    minimize: false,
    timestamps: true
  }
);

const BotState = mongoose.models.BotState || mongoose.model("BotState", botStateSchema);
const WebUser = mongoose.models.WebUser || mongoose.model("WebUser", webUserSchema);
const InviteCode = mongoose.models.InviteCode || mongoose.model("InviteCode", inviteCodeSchema);
const PairingLog = mongoose.models.PairingLog || mongoose.model("PairingLog", pairingLogSchema);

let connectPromise = null;
let activeMongoUri = null;
let storageMode = "mongo";

function ensureJsonFile(filePath, initialValue) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(initialValue, null, 2));
  }
}

function readJsonFile(filePath, initialValue) {
  try {
    ensureJsonFile(filePath, initialValue);
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return initialValue;
  }
}

function writeJsonFile(filePath, value) {
  ensureJsonFile(filePath, Array.isArray(value) ? [] : {});
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function readLegacyJsonDb() {
  try {
    if (!fs.existsSync(LEGACY_JSON_PATH)) return {};
    const raw = fs.readFileSync(LEGACY_JSON_PATH, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    console.error("[DB] Gagal membaca legacy database.json:", error.message);
    return {};
  }
}

async function connectDatabase() {
  if (storageMode === "json") {
    return null;
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!connectPromise) {
    connectPromise = (async () => {
      const candidates = [PRIMARY_MONGO_URI, FALLBACK_MONGO_URI];
      let lastError = null;

      for (const uri of candidates) {
        try {
          const connection = await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 5000
          });
          activeMongoUri = uri;
          storageMode = "mongo";
          if (uri !== PRIMARY_MONGO_URI) {
            console.warn(`[DB] Mongo utama gagal. Menggunakan fallback: ${uri}`);
          } else {
            console.log("[DB] MongoDB terhubung.");
          }
          return connection;
        } catch (error) {
          lastError = error;
          activeMongoUri = null;
          if (mongoose.connection.readyState !== 0) {
            try {
              await mongoose.disconnect();
            } catch {}
          }
          console.warn(`[DB] Gagal konek ke ${uri}: ${error.message}`);
        }
      }

      storageMode = "json";
      console.warn("[DB] Semua koneksi Mongo gagal. Fallback ke JSON lokal di folder database.");
      return null;
    })();
  }

  try {
    return await connectPromise;
  } catch (error) {
    connectPromise = null;
    throw error;
  } finally {
    connectPromise = null;
  }
}

function getStorageMode() {
  return storageMode;
}

function getActiveMongoUri() {
  return activeMongoUri;
}

const webUsersRepo = {
  async findByIdentifier(identifier) {
    await connectDatabase();
    if (storageMode === "mongo") {
      return WebUser.findOne({
        $or: [{ email: identifier }, { username: identifier }]
      });
    }

    const users = readJsonFile(WEB_USERS_PATH, []);
    return users.find((user) => user.email === identifier || user.username === identifier) || null;
  },

  async findByEmailOrUsername(email, username) {
    await connectDatabase();
    if (storageMode === "mongo") {
      return WebUser.findOne({
        $or: [{ email }, { username }]
      });
    }

    const users = readJsonFile(WEB_USERS_PATH, []);
    return users.find((user) => user.email === email || user.username === username) || null;
  },

  async create(data) {
    await connectDatabase();
    if (storageMode === "mongo") {
      return WebUser.create(data);
    }

    const users = readJsonFile(WEB_USERS_PATH, []);
    const user = {
      _id: crypto.randomUUID(),
      name: data.name,
      username: data.username,
      email: data.email,
      passwordHash: data.passwordHash,
      avatarMode: data.avatarMode || "link",
      avatarUrl: data.avatarUrl || "",
      avatarUpload: data.avatarUpload || "",
      role: data.role || "admin",
      isActive: data.isActive !== false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    users.push(user);
    writeJsonFile(WEB_USERS_PATH, users);
    return user;
  },

  async updateById(id, patch) {
    await connectDatabase();
    if (storageMode === "mongo") {
      return WebUser.findByIdAndUpdate(id, { $set: patch }, { new: true });
    }

    const users = readJsonFile(WEB_USERS_PATH, []);
    const index = users.findIndex((user) => user._id === String(id));
    if (index === -1) return null;
    users[index] = {
      ...users[index],
      ...patch,
      updatedAt: new Date().toISOString()
    };
    writeJsonFile(WEB_USERS_PATH, users);
    return users[index];
  }
};

const inviteCodesRepo = {
  async countAll() {
    await connectDatabase();
    if (storageMode === "mongo") {
      return InviteCode.countDocuments();
    }

    return readJsonFile(INVITE_CODES_PATH, []).length;
  },

  async findActiveByCode(code) {
    await connectDatabase();
    if (storageMode === "mongo") {
      return InviteCode.findOne({ code, isActive: true });
    }

    const invites = readJsonFile(INVITE_CODES_PATH, []);
    return invites.find((invite) => invite.code === code && invite.isActive) || null;
  },

  async create(data) {
    await connectDatabase();
    if (storageMode === "mongo") {
      return InviteCode.create(data);
    }

    const invites = readJsonFile(INVITE_CODES_PATH, []);
    const invite = {
      _id: crypto.randomUUID(),
      code: String(data.code || "").toUpperCase(),
      label: data.label || "default invite",
      isActive: data.isActive !== false,
      createdBy: data.createdBy || "system",
      usedBy: null,
      usedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    invites.push(invite);
    writeJsonFile(INVITE_CODES_PATH, invites);
    return invite;
  },

  async markUsed(inviteId, userId) {
    await connectDatabase();
    if (storageMode === "mongo") {
      const invite = await InviteCode.findById(inviteId);
      if (!invite) return null;
      invite.isActive = false;
      invite.usedBy = userId;
      invite.usedAt = new Date();
      await invite.save();
      return invite;
    }

    const invites = readJsonFile(INVITE_CODES_PATH, []);
    const index = invites.findIndex((invite) => invite._id === String(inviteId));
    if (index === -1) return null;
    invites[index].isActive = false;
    invites[index].usedBy = String(userId);
    invites[index].usedAt = new Date().toISOString();
    invites[index].updatedAt = new Date().toISOString();
    writeJsonFile(INVITE_CODES_PATH, invites);
    return invites[index];
  }
};

const pairingLogsRepo = {
  async create(data) {
    await connectDatabase();
    if (storageMode === "mongo") {
      return PairingLog.create(data);
    }

    const logs = readJsonFile(PAIRING_LOGS_PATH, []);
    const log = {
      _id: crypto.randomUUID(),
      kind: data.kind,
      phone: data.phone || null,
      status: data.status || null,
      code: data.code || null,
      error: data.error || null,
      meta: data.meta || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    logs.push(log);
    writeJsonFile(PAIRING_LOGS_PATH, logs);
    return log;
  },

  async listRecent(limit = 6, filter = {}) {
    await connectDatabase();
    if (storageMode === "mongo") {
      const query = {};
      if (filter.sessionId) {
        query["meta.sessionId"] = filter.sessionId;
      }
      if (filter.ownerId) {
        query["meta.ownerId"] = filter.ownerId;
      }
      return PairingLog.find(query).sort({ createdAt: -1 }).limit(limit).lean();
    }

    const logs = readJsonFile(PAIRING_LOGS_PATH, []);
    return [...logs]
      .filter((log) => {
        if (filter.sessionId && log?.meta?.sessionId !== filter.sessionId) return false;
        if (filter.ownerId && log?.meta?.ownerId !== filter.ownerId) return false;
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }
};

const botSessionsRepo = {
  async listAll() {
    const sessions = readJsonFile(BOT_SESSIONS_PATH, []);
    return Array.isArray(sessions) ? sessions : [];
  },

  async listByOwner(ownerId) {
    const sessions = await this.listAll();
    return sessions.filter((session) => session.ownerId === ownerId);
  },

  async findById(id) {
    const sessions = await this.listAll();
    return sessions.find((session) => session.id === id) || null;
  },

  async upsert(record) {
    const sessions = await this.listAll();
    const now = new Date().toISOString();
    const index = sessions.findIndex((session) => session.id === record.id);
    const nextRecord = {
      ...record,
      updatedAt: now
    };

    if (index >= 0) {
      sessions[index] = {
        ...sessions[index],
        ...nextRecord
      };
    } else {
      sessions.push({
        createdAt: now,
        ...nextRecord
      });
    }

    writeJsonFile(BOT_SESSIONS_PATH, sessions);
    return sessions[index >= 0 ? index : sessions.length - 1];
  },

  async deleteById(id) {
    const sessions = await this.listAll();
    const filtered = sessions.filter((session) => session.id !== id);
    if (filtered.length === sessions.length) return false;
    writeJsonFile(BOT_SESSIONS_PATH, filtered);
    return true;
  }
};

async function ensureInviteSeed() {
  const count = await inviteCodesRepo.countAll();
  if (count > 0) return null;

  const invite = await inviteCodesRepo.create({
    code: DEFAULT_INVITE_CODE,
    label: "initial dashboard invite",
    createdBy: "system"
  });

  console.log(`[Web] Invite code default dibuat: ${invite.code}`);
  return invite;
}

module.exports = {
  HOST,
  PORT,
  MONGO_URI,
  PRIMARY_MONGO_URI,
  FALLBACK_MONGO_URI,
  SESSION_SECRET,
  DEFAULT_INVITE_CODE,
  LEGACY_JSON_PATH,
  connectDatabase,
  getStorageMode,
  getActiveMongoUri,
  readLegacyJsonDb,
  ensureInviteSeed,
  BotState,
  webUsersRepo,
  inviteCodesRepo,
  pairingLogsRepo,
  botSessionsRepo
};
