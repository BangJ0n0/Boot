const crypto = require("crypto");
const {
  generateWAMessageContent,
  generateWAMessageFromContent,
} = require("@wanzofc1/baileys");

const STORY_STATUS_JID = "status@broadcast";
const STORY_TTL_MS = 24 * 60 * 60 * 1000;
const STORY_SEND_DELAY_MS = 2000;
const MAX_TRACKED_STORIES = 1500;
const STORY_BG_COLORS = [
  "#FF5733",
  "#33FF57",
  "#3357FF",
  "#F033FF",
  "#FF33F0",
  "#33FFF0",
  "#F0FF33",
  "#FF8333",
  "#8333FF",
  "#33FF83",
];

function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureStoryStore(db) {
  if (!db.settings || typeof db.settings !== "object") db.settings = {};
  if (!db.settings.storyStore || typeof db.settings.storyStore !== "object") {
    db.settings.storyStore = { records: [] };
  }
  if (!Array.isArray(db.settings.storyStore.records)) {
    db.settings.storyStore.records = [];
  }
  pruneStoryStore(db.settings.storyStore);
  return db.settings.storyStore;
}

function pruneStoryStore(store) {
  if (!store || !Array.isArray(store.records)) return [];
  const now = Date.now();
  store.records = store.records
    .filter((record) => {
      const createdAt = Date.parse(record?.createdAt || "");
      if (!Number.isFinite(createdAt)) return false;
      if (record.deletedAt) return false;
      return now - createdAt <= STORY_TTL_MS;
    })
    .slice(-MAX_TRACKED_STORIES);
  return store.records;
}

function getTargetLabel(target = {}) {
  if (target.label) return target.label;
  if (target.name) return target.name;
  if (target.jid === STORY_STATUS_JID) return "Status Pribadi";
  return target.jid || "Tanpa Nama";
}

function makeTrackedKey(key = {}, fallbackJid = "") {
  return {
    remoteJid: key.remoteJid || fallbackJid,
    id: key.id,
    fromMe: key.fromMe !== false,
    participant: key.participant || null,
  };
}

function trackStory(db, target, key, source = "manual") {
  if (!key?.id || !target?.jid) return null;
  const store = ensureStoryStore(db);
  const trackedKey = makeTrackedKey(key, target.jid);
  const record = {
    id: trackedKey.id,
    remoteJid: trackedKey.remoteJid,
    participant: trackedKey.participant,
    fromMe: trackedKey.fromMe,
    label: getTargetLabel(target),
    type: target.jid === STORY_STATUS_JID ? "status" : "group",
    source,
    createdAt: new Date().toISOString(),
    deletedAt: null,
  };

  store.records.push(record);
  pruneStoryStore(store);
  return record;
}

function getActiveStoryRecords(db) {
  const store = ensureStoryStore(db);
  return pruneStoryStore(store).filter((record) => !record.deletedAt);
}

function getStoryTargetSummaries(db) {
  const summaries = new Map();
  for (const record of getActiveStoryRecords(db)) {
    const current = summaries.get(record.remoteJid) || {
      jid: record.remoteJid,
      label: record.label,
      type: record.type,
      count: 0,
      lastSentAt: record.createdAt,
    };
    current.count += 1;
    if (Date.parse(record.createdAt) > Date.parse(current.lastSentAt || 0)) {
      current.lastSentAt = record.createdAt;
    }
    if (!current.label && record.label) current.label = record.label;
    summaries.set(record.remoteJid, current);
  }

  return [...summaries.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type === "status" ? -1 : 1;
    return Date.parse(b.lastSentAt || 0) - Date.parse(a.lastSentAt || 0);
  });
}

function buildStoryContent({ text = "", mediaType = null, mediaUrl = null }) {
  if (mediaType && mediaUrl) {
    return {
      [mediaType]: { url: mediaUrl },
      caption: text || undefined,
    };
  }

  const backgroundColor =
    STORY_BG_COLORS[Math.floor(Math.random() * STORY_BG_COLORS.length)];
  return {
    text,
    backgroundColor,
    font: Math.floor(Math.random() * 7) + 1,
  };
}

async function sendGroupStory(sock, targetJid, content, senderJid) {
  const inside = await generateWAMessageContent(content, {
    upload: sock.waUploadToServer,
    logger: sock.logger,
  });

  const messageSecret = crypto.randomBytes(32);
  const msg = await generateWAMessageFromContent(
    targetJid,
    {
      messageContextInfo: { messageSecret },
      groupStatusMessageV2: {
        message: {
          ...inside,
          messageContextInfo: { messageSecret },
        },
      },
    },
    { userJid: senderJid || sock.user?.id }
  );

  await sock.relayMessage(targetJid, msg.message, { messageId: msg.key.id });
  return msg.key;
}

async function sendStoryBatch(
  sock,
  db,
  {
    targets = [],
    text = "",
    mediaType = null,
    mediaUrl = null,
    senderJid = null,
    source = "manual",
    delayMs = STORY_SEND_DELAY_MS,
  } = {}
) {
  if (!Array.isArray(targets) || targets.length === 0) {
    return { total: 0, success: 0, failed: 0, failures: [] };
  }

  const failures = [];
  let success = 0;
  let failed = 0;

  for (const target of targets) {
    try {
      const content = buildStoryContent({ text, mediaType, mediaUrl });
      let key;

      if (target.jid === STORY_STATUS_JID) {
        const response = await sock.sendMessage(target.jid, content);
        key = response?.key;
      } else {
        key = await sendGroupStory(sock, target.jid, content, senderJid);
      }

      trackStory(db, target, key, source);
      success += 1;
      if (delayMs) await sleep(delayMs);
    } catch (error) {
      failed += 1;
      failures.push({
        jid: target.jid,
        label: getTargetLabel(target),
        error: error?.message || "Unknown error",
      });
    }
  }

  return {
    total: targets.length,
    success,
    failed,
    failures,
  };
}

async function deleteTrackedStories(sock, db, filterFn = null) {
  const records = getActiveStoryRecords(db).filter((record) =>
    typeof filterFn === "function" ? filterFn(record) : true
  );

  let success = 0;
  let failed = 0;
  const failures = [];

  for (const record of records) {
    try {
      const key = {
        remoteJid: record.remoteJid,
        id: record.id,
        fromMe: true,
      };

      if (record.participant) key.participant = record.participant;

      await sock.sendMessage(record.remoteJid, { delete: key });
      record.deletedAt = new Date().toISOString();
      success += 1;
      await sleep(400);
    } catch (error) {
      failed += 1;
      failures.push({
        jid: record.remoteJid,
        label: record.label,
        id: record.id,
        error: error?.message || "Unknown error",
      });
    }
  }

  return {
    total: records.length,
    success,
    failed,
    failures,
  };
}

async function getGroupStoryTargets(sock, includeStatus = false) {
  const groups = await sock.groupFetchAllParticipating();
  const targets = Object.keys(groups).map((jid) => ({
    jid,
    name: groups[jid]?.subject || jid,
  }));

  if (includeStatus) {
    targets.unshift({
      jid: STORY_STATUS_JID,
      name: "Status Pribadi",
      label: "Status Pribadi",
    });
  }

  return targets;
}

module.exports = {
  STORY_STATUS_JID,
  ensureStoryStore,
  getActiveStoryRecords,
  getStoryTargetSummaries,
  getGroupStoryTargets,
  sendStoryBatch,
  deleteTrackedStories,
};
