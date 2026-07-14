"use strict";

const MEDIA_MESSAGE_TYPES = new Set([
  "audioMessage",
  "documentMessage",
  "imageMessage",
  "stickerMessage",
  "videoMessage"
]);

const IGNORED_MESSAGE_TYPES = new Set([
  "messageContextInfo",
  "protocolMessage",
  "senderKeyDistributionMessage"
]);

function numberValue(value) {
  if (typeof value === "number") {
    return value;
  }

  if (value && typeof value.toNumber === "function") {
    return value.toNumber();
  }

  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function textFromMessage(type, content) {
  const value = content[type] || {};

  if (type === "conversation") {
    return typeof value === "string" ? value : null;
  }

  if (type === "extendedTextMessage") {
    return value.text || null;
  }

  if (["imageMessage", "videoMessage", "documentMessage"].includes(type)) {
    return value.caption || value.fileName || null;
  }

  if (type === "buttonsResponseMessage" || type === "templateButtonReplyMessage") {
    return value.selectedDisplayText || value.selectedButtonId || null;
  }

  if (type === "listResponseMessage") {
    return value.title || (value.singleSelectReply && value.singleSelectReply.selectedRowId) || null;
  }

  if (type === "reactionMessage") {
    return value.text || null;
  }

  if (type === "pollCreationMessage") {
    return value.name || null;
  }

  return null;
}

function mediaMetadata(type, content) {
  if (!MEDIA_MESSAGE_TYPES.has(type)) {
    return null;
  }

  const value = content[type] || {};
  return JSON.stringify({
    mediaType: type,
    duration: numberValue(value.seconds) || null,
    isGif: Boolean(value.gifPlayback),
    isViewOnce: Boolean(value.viewOnce),
    isPtt: Boolean(value.ptt)
  });
}

function isStorableMessage(type, remoteJid) {
  return Boolean(type && remoteJid && !IGNORED_MESSAGE_TYPES.has(type));
}

function toStoredMessage(message, ownJid, helpers) {
  const key = message && message.key ? message.key : {};
  if (!key.id || !key.remoteJid || !message.message) {
    return null;
  }

  const content = helpers.extractMessageContent(message.message) || {};
  const type = helpers.getContentType(content);
  if (!isStorableMessage(type, key.remoteJid)) {
    return null;
  }

  const value = content[type] || {};
  const fromMe = Boolean(key.fromMe);
  const senderId = fromMe
    ? (ownJid || null)
    : (key.participantAlt || key.participant || key.remoteJid);
  const recipientId = fromMe ? key.remoteJid : (ownJid || null);

  return {
    id: { _serialized: key.id },
    fromMe,
    from: senderId,
    to: recipientId,
    body: textFromMessage(type, content),
    type,
    timestamp: numberValue(message.messageTimestamp) || Math.floor(Date.now() / 1000),
    hasMedia: MEDIA_MESSAGE_TYPES.has(type),
    mimetype: value.mimetype || null,
    filename: value.fileName || null,
    size: numberValue(value.fileLength) || null,
    mediaMetadata: mediaMetadata(type, content),
    chatId: key.remoteJid
  };
}

module.exports = {
  isStorableMessage,
  toStoredMessage
};
