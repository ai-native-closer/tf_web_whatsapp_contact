"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { toStoredMessage } = require("../src/baileys-message");
const { isDirectChatId, phoneFromChatId, toChatId } = require("../src/phone");

const helpers = {
  extractMessageContent: (message) => message,
  getContentType: (content) => Object.keys(content)[0]
};

test("uses Baileys personal JIDs while keeping legacy records readable", () => {
  assert.equal(toChatId("+86 138-0013-8000"), "8613800138000@s.whatsapp.net");
  assert.equal(isDirectChatId("8613800138000@s.whatsapp.net"), true);
  assert.equal(isDirectChatId("8613800138000@c.us"), true);
  assert.equal(isDirectChatId("120363000000000@g.us"), false);
  assert.equal(phoneFromChatId("8613800138000@s.whatsapp.net"), "8613800138000");
});

test("normalizes an inbound Baileys text message for the existing message store", () => {
  const message = toStoredMessage({
    key: {
      id: "message-1",
      remoteJid: "8613800138000@s.whatsapp.net",
      fromMe: false
    },
    messageTimestamp: 1700000000,
    message: {
      extendedTextMessage: { text: "你好" }
    }
  }, "8613900138000@s.whatsapp.net", helpers);

  assert.deepEqual(message, {
    id: { _serialized: "message-1" },
    fromMe: false,
    from: "8613800138000@s.whatsapp.net",
    to: "8613900138000@s.whatsapp.net",
    body: "你好",
    type: "extendedTextMessage",
    timestamp: 1700000000,
    hasMedia: false,
    mimetype: null,
    filename: null,
    size: null,
    mediaMetadata: null,
    chatId: "8613800138000@s.whatsapp.net"
  });
});

test("normalizes media metadata without persisting the media encryption key", () => {
  const message = toStoredMessage({
    key: {
      id: "message-2",
      remoteJid: "8613800138000@s.whatsapp.net",
      fromMe: true
    },
    messageTimestamp: 1700000001,
    message: {
      imageMessage: {
        caption: "报价单",
        mimetype: "image/jpeg",
        fileLength: 2048,
        mediaKey: Buffer.from("sensitive-key"),
        viewOnce: true
      }
    }
  }, "8613900138000@s.whatsapp.net", helpers);

  assert.equal(message.body, "报价单");
  assert.equal(message.hasMedia, true);
  assert.equal(message.size, 2048);
  assert.equal(message.mediaMetadata.includes("sensitive-key"), false);
  assert.equal(JSON.parse(message.mediaMetadata).isViewOnce, true);
});

test("ignores protocol-only events", () => {
  const message = toStoredMessage({
    key: {
      id: "message-3",
      remoteJid: "8613800138000@s.whatsapp.net",
      fromMe: false
    },
    message: {
      protocolMessage: { type: 0 }
    }
  }, "8613900138000@s.whatsapp.net", helpers);

  assert.equal(message, null);
});
