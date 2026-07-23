"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MessageStore } = require("../src/message-store");

test("reuses the phone conversation for a reply from a mapped LID", async () => {
  const calls = [];
  const store = new MessageStore({
    execute: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("FROM wa_lid_mappings")) {
        return [[{ phone_chat_id: "8613800138000@s.whatsapp.net" }]];
      }
      return [{ affectedRows: 0 }];
    }
  }, {});
  let conversationChatId;
  store.upsertConversation = async (_accountId, chatId) => {
    conversationChatId = chatId;
    return { id: 1 };
  };

  await store.saveWhatsAppMessage(7, {
    id: { id: "message-1" },
    fromMe: false,
    from: "123456789@lid",
    to: "me@s.whatsapp.net",
    body: "reply",
    type: "conversation",
    timestamp: 1
  }, { chatId: "123456789@lid" });

  assert.equal(conversationChatId, "8613800138000@s.whatsapp.net");
  assert.deepEqual(calls[0].params, [7, "123456789@lid"]);
});

test("keeps an unmapped LID unchanged until WhatsApp supplies its mapping", async () => {
  const store = new MessageStore({
    execute: async () => [[]]
  }, {});

  assert.equal(await store.resolveMappedChatId(7, "123456789@lid"), "123456789@lid");
});

test("does not query LID mappings for a phone-based chat", async () => {
  const store = new MessageStore({
    execute: async () => {
      throw new Error("phone chat IDs must not query LID mappings");
    }
  }, {});

  assert.equal(await store.resolveMappedChatId(7, "8613800138000@s.whatsapp.net"), "8613800138000@s.whatsapp.net");
});

test("updates the shared contact name on the existing conversation", async () => {
  const calls = [];
  const store = new MessageStore({
    execute: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("SELECT")) {
        return [[{ id: 12, contact_name: "采购负责人" }]];
      }
      return [{ affectedRows: 1 }];
    }
  }, {});

  const conversation = await store.setContactName(12, "采购负责人");

  assert.deepEqual(calls[0].params, ["采购负责人", 12]);
  assert.equal(conversation.contact_name, "采购负责人");
});
