require("../config.js");
const {
  extractMessageContent,
  jidNormalizedUser,
  proto,
  delay,
  getContentType,
  areJidsSameUser,
  generateWAMessage
} = require("@wanzofc1/Baileys");

const serialize = async (conn, m) => {
  if (!m) return m;
  const { WebMessageInfo } = proto;

  const safeToLid = async (jid) => {
    if (jid && jid.endsWith("@s.whatsapp.net") && typeof conn.toLid === "function") {
      return await conn.toLid(jid);
    }
    return jid;
  };

  const decodeMaybeJid = async (jid) => {
    if (!jid) return jid;
    const decoded = typeof conn.decodeJid === "function" ? await conn.decodeJid(jid) : jid;
    return /@s\.whatsapp\.net$/i.test(decoded) ? safeToLid(decoded) : decoded;
  };

  const pickParticipantJid = (messageNode) => {
    if (!messageNode) return null;
    const content = extractMessageContent(messageNode) || messageNode;
    const nested = content?.contextInfo?.participant
      || content?.participant
      || content?.sender
      || content?.author;

    if (nested) return nested;

    for (const value of Object.values(content || {})) {
      if (value && typeof value === "object") {
        const candidate = pickParticipantJid(value);
        if (candidate) return candidate;
      }
    }

    return null;
  };

  if (m.key) {
    m.id = m.key.id;
    m.chat = /@s.whatsapp.net/.test(m.key.remoteJid) ? await safeToLid(m.key.remoteJid) : m.key.remoteJid;
    m.isBaileys = m.id
      ? (
          m.id.startsWith("3EB0") ||
          m.id.startsWith("B1E") ||
          m.id.startsWith("BAE") ||
          m.id.startsWith("3F8") ||
          m.id.length < 32 || m.id.length === 18
        )
      : false;
    m.fromMe = m.key.fromMe;

    m.botNumber = conn.user && conn.user.lid
      ? `${conn.user.lid.split(":")[0]}@lid`
      : await decodeMaybeJid(conn.user.id);

    const ownerNum = await safeToLid(global.owner + "@s.whatsapp.net");

    m.isChannel = m.chat.endsWith("@newsletter");
    m.isGroup = m.chat.endsWith("@g.us");

    const rawParticipant = m.participant
      || m.key.participant
      || pickParticipantJid(m.message)
      || null;

    m.participant = m.isGroup ? await decodeMaybeJid(rawParticipant) : rawParticipant;
    const senderSource = m.fromMe ? conn.user.id : (m.participant || m.chat);
    m.sender = await decodeMaybeJid(senderSource);
    m.isOwner = m.sender === m.botNumber || m.sender === ownerNum || global.owner.includes(m.sender.split("@")[0]);
  }

  if (m.message) {
    m.mtype = await getContentType(m.message);
    m.prefix = ".";
    const content = m.message[m.mtype];
    m.msg =
      m.mtype === "viewOnceMessage"
        ? m.message[m.mtype].message[getContentType(m.message[m.mtype].message)]
        : content;
    m.body =
      m?.message?.conversation ||
      m?.msg?.caption ||
      m?.msg?.text ||
      (m.mtype === "extendedTextMessage" && m.msg.text) ||
      (m.mtype === "buttonsResponseMessage" && m.msg.selectedButtonId) ||
      (m.mtype === "interactiveResponseMessage" &&
        JSON.parse(m.msg.nativeFlowResponseMessage.paramsJson || "{}")?.id) ||
      (m.mtype === "templateButtonReplyMessage" && m.msg.selectedId) ||
      (m.mtype === "listResponseMessage" &&
        m.msg.singleSelectReply?.selectedRowId) ||
      "";

    const quotedMessage = (m.quoted = m.msg?.contextInfo?.quotedMessage || null);
    m.mentionedJid = m.msg?.contextInfo?.mentionedJid || [];

    if (quotedMessage) {
      let qType = getContentType(quotedMessage);
      m.quoted = quotedMessage[qType];
      if (qType === "productMessage") {
        qType = getContentType(m.quoted);
        m.quoted = m.quoted[qType];
      }
      if (typeof m.quoted === "string") m.quoted = { text: m.quoted };
      if (m.quoted) {
        const quotedParticipant = m.msg.contextInfo.participant
          || pickParticipantJid(quotedMessage)
          || m.msg.contextInfo.remoteJid
          || null;

        m.quoted.key = {
          remoteJid: m.msg.contextInfo.remoteJid || m.chat,
          participant: await decodeMaybeJid(quotedParticipant),
          fromMe: areJidsSameUser(
            jidNormalizedUser(m.msg.contextInfo.participant || ""),
            jidNormalizedUser(conn.user.id)
          ),
          id: m.msg.contextInfo.stanzaId
        };
        m.quoted.mtype = qType;
        m.quoted.chat = /@s.whatsapp.net/.test(m.quoted.key.remoteJid)
          ? await safeToLid(m.quoted.key.remoteJid)
          : m.quoted.key.remoteJid;
        m.quoted.id = m.quoted.key.id;
        m.quoted.isBaileys = m.quoted.id
          ? (
              m.quoted.id.startsWith("3EB0") ||
              m.quoted.id.startsWith("B1E") ||
              m.quoted.id.startsWith("3F8") ||
              m.quoted.id.startsWith("BAE") ||
              m.quoted.id.length < 32
            )
          : false;
        m.quoted.sender = await decodeMaybeJid(m.quoted.key.participant);
        m.quoted.fromMe = m.quoted.sender === conn.user.id;
        m.quoted.text =
          m.quoted.text ||
          m.quoted.caption ||
          m.quoted.conversation ||
          m.quoted.contentText ||
          m.quoted.selectedDisplayText ||
          m.quoted.title ||
          "";
        m.quoted.mentionedJid = m.msg.contextInfo?.mentionedJid || [];
        m.quoted.fakeObj = WebMessageInfo.fromObject({
          key: m.quoted.key,
          message: quotedMessage,
          ...(m.isGroup ? { participant: m.quoted.sender } : {})
        });
        m.quoted.download = (saveToFile = false) =>
          conn.downloadMediaMessage(
            m.quoted,
            m.quoted.mtype.replace(/message/i, ""),
            saveToFile
          );
      }
    }
  }

  if (m.msg?.url) {
    m.download = (saveToFile = false) =>
      conn.downloadMediaMessage(
        m.msg,
        m.mtype.replace(/message/i, ""),
        saveToFile
      );
  }

  m.text = m.body;

  m.reply = async (text, options = {}) => {
    const chatId = options.chat || m.chat;
    const quoted = options.quoted || m;
    const mentions = [...text.matchAll(/@(\d{0,19})/g)].map(
      (value) => value[1] + (typeof conn.toLid === "function" ? "@lid" : "@s.whatsapp.net")
    );
    return conn.sendMessage(
      chatId,
      { text, mentions, ...options },
      { quoted }
    );
  };

  return m;
};

module.exports = serialize;
