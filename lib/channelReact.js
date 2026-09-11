const DEFAULT_REACTION_EMOJIS = ["❤️", "🔥", "😂", "👍", "😍", "👏", "🎉", "😭"];
const DEFAULT_REACTION_COUNTS = [1, 5, 10, 25, 50, 100];
const DEFAULT_DELAY_MS = 900;
const FETCH_TIMEOUT_MS = 12000;
const STYLE_SEPARATOR = "―";
const DECORATIVE_MAP = {
  a: "🅐",
  b: "🅑",
  c: "🅒",
  d: "🅓",
  e: "🅔",
  f: "🅕",
  g: "🅖",
  h: "🅗",
  i: "🅘",
  j: "🅙",
  k: "🅚",
  l: "🅛",
  m: "🅜",
  n: "🅝",
  o: "🅞",
  p: "🅟",
  q: "🅠",
  r: "🅡",
  s: "🅢",
  t: "🅣",
  u: "🅤",
  v: "🅥",
  w: "🅦",
  x: "🅧",
  y: "🅨",
  z: "🅩",
  0: "⓿",
  1: "➊",
  2: "➋",
  3: "➌",
  4: "➍",
  5: "➎",
  6: "➏",
  7: "➐",
  8: "➑",
  9: "➒",
};

function looksLikeEmoji(value = "") {
  return /[^\p{Letter}\p{Number}\s_-]/u.test(String(value));
}

function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label = "Operation") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout setelah ${ms}ms`)), ms)
    ),
  ]);
}

function ensureChannelReactStore(db) {
  if (!db.settings || typeof db.settings !== "object") db.settings = {};
  if (!db.settings.channelReact || typeof db.settings.channelReact !== "object") {
    db.settings.channelReact = { sessions: {} };
  }
  if (!db.settings.channelReact.sessions || typeof db.settings.channelReact.sessions !== "object") {
    db.settings.channelReact.sessions = {};
  }
  return db.settings.channelReact;
}

function normalizeChannelInput(input = "") {
  const text = String(input || "").trim();
  if (!text) return null;

  const urlMatch = text.match(
    /(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/([A-Za-z0-9]+)(?:\/(\d+))?/i
  );
  if (urlMatch) {
    return {
      type: "invite",
      key: urlMatch[1],
      url: `https://whatsapp.com/channel/${urlMatch[1]}`,
      postId: urlMatch[2] || null,
    };
  }

  const jidMatch = text.match(/(\d+@newsletter)/i);
  if (jidMatch) {
    return {
      type: "jid",
      key: jidMatch[1],
      url: null,
      postId: null,
    };
  }

  return null;
}

function extractServerIdsFromNode(node) {
  const ids = [];

  const walk = (entry) => {
    if (!entry) return;
    if (Array.isArray(entry)) {
      for (const item of entry) walk(item);
      return;
    }
    if (typeof entry !== "object") return;

    if (entry.tag === "message" && entry.attrs) {
      const id = entry.attrs.server_id || entry.attrs.message_id || entry.attrs.id;
      if (id) ids.push(id);
    }

    if (Array.isArray(entry.content)) walk(entry.content);
  };

  walk(node);
  return [...new Set(ids)];
}

async function resolveChannelTarget(sock, input) {
  const parsed = normalizeChannelInput(input);
  if (!parsed) throw new Error("Link atau JID channel tidak valid.");

  const metadata = await sock.newsletterMetadata(parsed.type, parsed.key);
  let messageServerIds = [];
  let fetchError = null;
  let latestServerId = parsed.postId || null;

  if (!latestServerId) {
    try {
      const fetchResult = await withTimeout(
        sock.newsletterFetchMessages(metadata.id, 10),
        FETCH_TIMEOUT_MS,
        "newsletterFetchMessages"
      );
      messageServerIds = extractServerIdsFromNode(fetchResult);
      latestServerId = messageServerIds[0] || null;
    } catch (error) {
      fetchError = error?.message || "Gagal mengambil daftar post channel";
    }
  }

  return {
    jid: metadata.id,
    url: metadata.invite ? `https://whatsapp.com/channel/${metadata.invite}` : parsed.url,
    metadata,
    latestServerId,
    postId: parsed.postId || null,
    messageServerIds,
    fetchError,
  };
}

function getReactionPresets(metadata = null) {
  const raw = metadata?.reaction_codes;
  const presets = [];

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string" && item.trim() && looksLikeEmoji(item.trim())) {
        presets.push(item.trim());
      }
    }
  } else if (
    typeof raw === "string" &&
    raw.trim() &&
    raw.trim().length <= 8 &&
    looksLikeEmoji(raw.trim())
  ) {
    presets.push(raw.trim());
  }

  for (const emoji of DEFAULT_REACTION_EMOJIS) {
    if (!presets.includes(emoji)) presets.push(emoji);
  }

  return presets.slice(0, 10);
}

function getChannelReactSession(db, sender) {
  const store = ensureChannelReactStore(db);
  return store.sessions[sender] || null;
}

function setChannelReactSession(db, sender, value) {
  const store = ensureChannelReactStore(db);
  store.sessions[sender] = {
    ...(store.sessions[sender] || {}),
    ...value,
    updatedAt: new Date().toISOString(),
  };
  return store.sessions[sender];
}

function clearChannelReactSession(db, sender) {
  const store = ensureChannelReactStore(db);
  delete store.sessions[sender];
}

function sanitizeReactionCount(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.min(parsed, 200);
}

function formatStyledReaction(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";

  if (!/[A-Za-z0-9]/.test(text)) {
    return text;
  }

  return [...text]
    .map((char) => {
      if (char === " ") return STYLE_SEPARATOR;
      const normalized = char.toLowerCase();
      return DECORATIVE_MAP[normalized] || char;
    })
    .join("");
}

function parseMultiPostReactInput(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;

  const [firstToken] = trimmed.split(/\s+/, 1);
  const parsedChannel = normalizeChannelInput(firstToken);
  if (!parsedChannel?.postId) return null;

  let payload = trimmed.slice(firstToken.length).trim();
  if (!payload) return null;

  let amount = 1;
  const pipeIndex = payload.lastIndexOf("|");
  if (pipeIndex !== -1) {
    const maybeCount = payload.slice(pipeIndex + 1).trim();
    if (/^\d+$/.test(maybeCount)) {
      amount = sanitizeReactionCount(maybeCount) || 1;
      payload = payload.slice(0, pipeIndex).trim();
    }
  }

  if (!payload) return null;

  return {
    link: firstToken,
    parsedChannel,
    rawReaction: payload,
    formattedReaction: formatStyledReaction(payload),
    amount,
    postId: parsedChannel.postId,
  };
}

function buildMultiPostTargets(serverId, amount = 1) {
  const count = sanitizeReactionCount(amount) || 1;
  const startId = Number.parseInt(String(serverId || ""), 10);
  if (!Number.isFinite(startId) || startId < 1) {
    throw new Error("ID post channel tidak valid.");
  }

  const targets = [];
  for (let i = 0; i < count; i += 1) {
    const targetId = startId - i;
    if (targetId < 1) break;
    targets.push(String(targetId));
  }
  return targets;
}

async function reactChannelMultiPost(
  sock,
  { jid, serverId, reactionText, amount = 1, delayMs = DEFAULT_DELAY_MS }
) {
  if (!jid || !serverId) throw new Error("Target channel atau post channel belum siap.");
  if (!reactionText) throw new Error("Reaction channel belum dipilih.");

  const targets = buildMultiPostTargets(serverId, amount);
  let success = 0;
  let failed = 0;
  const failures = [];

  for (let i = 0; i < targets.length; i += 1) {
    try {
      await sock.newsletterReactMessage(jid, targets[i], reactionText);
      success += 1;
      if (i < targets.length - 1) await sleep(delayMs);
    } catch (error) {
      failed += 1;
      failures.push({
        postId: targets[i],
        error: error?.message || "Unknown error",
      });
      await sleep(350);
    }
  }

  return {
    success,
    failed,
    total: targets.length,
    startPostId: targets[0] || null,
    endPostId: targets[targets.length - 1] || null,
    targets,
    failures,
  };
}

async function resetChannelReaction(sock, { jid, serverId }) {
  if (!jid || !serverId) throw new Error("Target channel atau post channel belum siap.");
  await sock.newsletterReactMessage(jid, serverId, null);
  return true;
}

async function resetChannelReactionRange(
  sock,
  { jid, serverId, amount = 1, delayMs = DEFAULT_DELAY_MS }
) {
  if (!jid || !serverId) throw new Error("Target channel atau post channel belum siap.");

  const targets = buildMultiPostTargets(serverId, amount);
  let success = 0;
  let failed = 0;
  const failures = [];

  for (let i = 0; i < targets.length; i += 1) {
    try {
      await sock.newsletterReactMessage(jid, targets[i], null);
      success += 1;
      if (i < targets.length - 1) await sleep(delayMs);
    } catch (error) {
      failed += 1;
      failures.push({
        postId: targets[i],
        error: error?.message || "Unknown error",
      });
      await sleep(350);
    }
  }

  return {
    success,
    failed,
    total: targets.length,
    startPostId: targets[0] || null,
    endPostId: targets[targets.length - 1] || null,
    targets,
    failures,
  };
}

module.exports = {
  DEFAULT_REACTION_COUNTS,
  DEFAULT_REACTION_EMOJIS,
  ensureChannelReactStore,
  normalizeChannelInput,
  resolveChannelTarget,
  getReactionPresets,
  getChannelReactSession,
  setChannelReactSession,
  clearChannelReactSession,
  sanitizeReactionCount,
  formatStyledReaction,
  parseMultiPostReactInput,
  buildMultiPostTargets,
  reactChannelMultiPost,
  resetChannelReaction,
  resetChannelReactionRange,
};
