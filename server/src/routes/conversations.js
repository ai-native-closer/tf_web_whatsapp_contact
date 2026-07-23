"use strict";

const express = require("express");
const { asyncHandler, badRequest, notFound } = require("../http");
const { getCurrentAccount } = require("../current-account");
const { writeAudit } = require("../audit");
const { isDirectChatId, normalizePhone, toChatId } = require("../phone");
const { phoneFromChatId } = require("../message-store");

function parseJsonValue(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function serializeConversation(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    accountName: row.account_name,
    chatId: row.chat_id,
    contactPhone: row.contact_phone,
    contactName: row.contact_name,
    lastMessageText: row.last_message_text,
    lastMessageType: row.last_message_type,
    lastMessageDirection: row.last_message_direction,
    lastMessageAt: row.last_message_at,
    unreadCount: row.unread_count,
    historyCursorAt: row.history_cursor_at,
    hasMore: Boolean(row.has_more),
    lastSyncedAt: row.last_synced_at,
    leadLevel: row.lead_level || null,
    leadReason: row.lead_reason || null,
    leadEvidence: parseJsonValue(row.lead_evidence_json, []),
    leadConfidence: row.lead_confidence === null || row.lead_confidence === undefined ? null : Number(row.lead_confidence),
    leadScoreStatus: row.lead_score_status || "unscored",
    leadScoreError: row.lead_score_error || null,
    leadScoredAt: row.lead_scored_at || null,
    leadScoreSignature: row.lead_score_signature || null,
    leadManualLocked: Boolean(row.lead_manual_locked),
    leadManualNote: row.lead_manual_note || null,
    leadManualUserId: row.lead_manual_user_id || null,
    leadManualAt: row.lead_manual_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeMessage(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    chatId: row.chat_id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    direction: row.direction,
    messageType: row.message_type,
    body: row.body,
    hasMedia: Boolean(row.has_media),
    mediaMimeType: row.media_mime_type,
    mediaFilename: row.media_filename,
    mediaSize: row.media_size,
    mediaMetadata: row.media_metadata,
    waTimestamp: row.wa_timestamp,
    jobId: row.job_id,
    jobItemId: row.job_item_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeReachRow(row) {
  const peerPhone = row.contact_phone || phoneFromChatId(row.chat_id);
  return {
    conversationId: row.conversation_id,
    accountId: row.account_id,
    accountName: row.account_name,
    ownWhatsappPhone: row.own_whatsapp_phone,
    updatedAt: row.updated_at,
    companyName: row.contact_name || "",
    peerWhatsappAccount: peerPhone || "",
    peerCity: "",
    peerSource: "",
    peerLink: "",
    latestPostAt: null,
    isReached: Boolean(row.first_outbound_at),
    touchedAt: row.first_outbound_at || null
  };
}

async function getConversationOrThrow(messageStore, id) {
  const conversation = await messageStore.getConversation(id);
  if (!conversation) {
    throw notFound("Conversation not found");
  }

  return conversation;
}

async function getSelectedAccountId(pool) {
  const [rows] = await pool.execute(
    `
      SELECT id
      FROM wa_accounts
      WHERE is_current = 1 AND status = 'enabled'
      LIMIT 1
    `
  );

  return rows[0] ? rows[0].id : null;
}

async function getSingleResult(pool, jobId) {
  const [rows] = await pool.execute(
    `
      SELECT item.*
      FROM wa_send_job_items item
      WHERE item.job_id = ?
      LIMIT 1
    `,
    [jobId]
  );

  return rows[0] || null;
}

function createConversationsRouter(pool, manager, messageStore, jobQueue, leadClassifier) {
  const router = express.Router();

  router.get("/", asyncHandler(async (req, res) => {
    let accountId = null;
    if (req.query.accountId) {
      accountId = Number(req.query.accountId);
      if (!Number.isFinite(accountId) || accountId <= 0) {
        throw badRequest("Invalid accountId");
      }
    } else {
      accountId = await getSelectedAccountId(pool);
    }

    const conversations = await messageStore.listConversations(accountId);
    res.json({ conversations: conversations.map(serializeConversation) });
  }));

  router.get("/reach-list", asyncHandler(async (req, res) => {
    let accountId = null;
    if (req.query.accountId) {
      accountId = Number(req.query.accountId);
      if (!Number.isFinite(accountId) || accountId <= 0) {
        throw badRequest("Invalid accountId");
      }
    } else {
      accountId = await getSelectedAccountId(pool);
    }

    const rows = await messageStore.listReachRows(accountId);
    res.json({ rows: rows.map(serializeReachRow) });
  }));

  router.patch("/:id/contact", asyncHandler(async (req, res) => {
    const conversation = await getConversationOrThrow(messageStore, req.params.id);
    const { account } = await getCurrentAccount(pool, manager, false);
    if (Number(conversation.account_id) !== Number(account.id)) {
      throw badRequest("Conversation does not belong to the current account");
    }

    const contactName = String(req.body.contactName || "").trim();
    if (contactName.length > 180) {
      throw badRequest("Contact name must be 180 characters or fewer");
    }

    const updated = await messageStore.setContactName(conversation.id, contactName || null);
    await writeAudit(pool, {
      actorUserId: req.session.user.id,
      action: "set_contact_name",
      entityType: "wa_conversation",
      entityId: conversation.id,
      detail: { hasContactName: Boolean(contactName) }
    });

    res.json({ conversation: serializeConversation(updated || conversation) });
  }));

  router.post("/:id/lead-score", asyncHandler(async (req, res) => {
    if (!leadClassifier || !leadClassifier.isEnabled()) {
      throw badRequest("Lead scoring is disabled");
    }

    const conversation = await getConversationOrThrow(messageStore, req.params.id);
    if (conversation.lead_manual_locked) {
      throw badRequest("Lead level is manually locked");
    }

    await leadClassifier.scoreConversation(conversation.id, { force: true, requireUnlocked: true });
    const updated = await messageStore.getConversation(conversation.id);
    await writeAudit(pool, {
      actorUserId: req.session.user.id,
      action: "score_lead",
      entityType: "wa_conversation",
      entityId: conversation.id
    });

    res.json({ conversation: serializeConversation(updated || conversation) });
  }));

  router.patch("/:id/lead-level", asyncHandler(async (req, res) => {
    const conversation = await getConversationOrThrow(messageStore, req.params.id);
    const body = req.body || {};
    const rawLevel = body.level === undefined ? body.leadLevel : body.level;
    let updated = null;

    if (rawLevel !== undefined && rawLevel !== null && String(rawLevel).trim()) {
      const level = String(rawLevel).trim().toUpperCase();
      if (!["A", "B", "C"].includes(level)) {
        throw badRequest("Invalid lead level");
      }

      const manualLocked = body.manualLocked === undefined ? true : Boolean(body.manualLocked);
      updated = await messageStore.setManualLeadLevel(
        conversation.id,
        level,
        body.manualNote,
        req.session.user.id,
        manualLocked
      );

      await writeAudit(pool, {
        actorUserId: req.session.user.id,
        action: "set_lead_level",
        entityType: "wa_conversation",
        entityId: conversation.id,
        detail: {
          level,
          manualLocked,
          hasNote: Boolean(String(body.manualNote || "").trim())
        }
      });

      if (!manualLocked && leadClassifier && leadClassifier.isEnabled()) {
        await leadClassifier.schedule(conversation.id);
        updated = await messageStore.getConversation(conversation.id);
      }
    } else if (body.manualLocked === false) {
      updated = await messageStore.unlockManualLeadLevel(conversation.id, req.session.user.id);

      await writeAudit(pool, {
        actorUserId: req.session.user.id,
        action: "unlock_lead_level",
        entityType: "wa_conversation",
        entityId: conversation.id
      });

      if (leadClassifier && leadClassifier.isEnabled()) {
        await leadClassifier.schedule(conversation.id);
        updated = await messageStore.getConversation(conversation.id);
      }
    } else {
      throw badRequest("lead level or manualLocked=false is required");
    }

    res.json({ conversation: serializeConversation(updated || conversation) });
  }));

  router.post("/", asyncHandler(async (req, res) => {
    const { account } = await getCurrentAccount(pool, manager, false);
    const phoneNumber = normalizePhone(req.body.phoneNumber);
    const contactName = String(req.body.contactName || "").trim() || null;
    if (!await manager.isRegisteredPhone(phoneNumber)) {
      throw badRequest("Recipient is not registered on WhatsApp");
    }
    const conversation = await messageStore.upsertConversation(account.id, toChatId(phoneNumber), {
      contactPhone: phoneNumber,
      contactName
    });

    await messageStore.markConversationRead(conversation.id);
    const row = await messageStore.getConversation(conversation.id);
    const messages = await messageStore.listMessages(conversation.id, 120);
    await writeAudit(pool, {
      actorUserId: req.session.user.id,
      action: "create_conversation",
      entityType: "wa_conversation",
      entityId: conversation.id,
      detail: {
        accountId: account.id,
        phoneNumber
      }
    });

    res.status(201).json({
      conversation: serializeConversation(row || conversation),
      messages: messages.map(serializeMessage)
    });
  }));

  router.get("/:id/messages", asyncHandler(async (req, res) => {
    const conversation = await getConversationOrThrow(messageStore, req.params.id);
    const limit = Math.min(Math.max(Number(req.query.limit || 120), 1), 500);
    const markRead = req.query.markRead !== "false";
    const messages = await messageStore.listMessages(conversation.id, limit);

    if (markRead) {
      await messageStore.markConversationRead(conversation.id);
    }

    const updated = await messageStore.getConversation(conversation.id);
    res.json({
      conversation: serializeConversation(updated || conversation),
      messages: messages.map(serializeMessage)
    });
  }));

  router.post("/:id/sync-older", asyncHandler(async (req, res) => {
    const conversation = await getConversationOrThrow(messageStore, req.params.id);
    if (!conversation.has_more) {
      res.json({
        conversation: serializeConversation(conversation),
        result: { fetchedCount: 0, savedCount: 0, hasMore: false },
        messages: (await messageStore.listMessages(conversation.id, 120)).map(serializeMessage)
      });
      return;
    }

    const result = await manager.syncOlderConversation(conversation);
    const updated = await messageStore.getConversation(conversation.id);
    res.json({
      conversation: serializeConversation(updated || conversation),
      result,
      messages: (await messageStore.listMessages(conversation.id, 120)).map(serializeMessage)
    });
  }));

  router.post("/:id/messages", asyncHandler(async (req, res) => {
    const conversation = await getConversationOrThrow(messageStore, req.params.id);
    const { account } = await getCurrentAccount(pool, manager, true);

    if (Number(conversation.account_id) !== Number(account.id)) {
      throw badRequest("Conversation does not belong to the current account");
    }

    const phoneNumber = conversation.contact_phone || phoneFromChatId(conversation.chat_id);
    if (!phoneNumber) {
      throw badRequest("Conversation does not have a valid phone number");
    }

    const jobId = await jobQueue.createSingleSend(
      account.id,
      phoneNumber,
      req.body.messageText,
      req.session.user.id
    );
    const item = await getSingleResult(pool, jobId);

    await writeAudit(pool, {
      actorUserId: req.session.user.id,
      action: "send_conversation_message",
      entityType: "wa_conversation",
      entityId: conversation.id,
      detail: {
        accountId: account.id,
        jobId,
        status: item ? item.status : null,
        recipientPhone: item ? item.recipient_phone : phoneNumber
      }
    });

    if (!item || item.status !== "sent") {
      res.status(502).json({
        error: item && item.error_message ? item.error_message : "Message send failed",
        jobId,
        item
      });
      return;
    }

    await messageStore.markConversationRead(conversation.id);
    const updated = await messageStore.getConversation(conversation.id);
    const messages = await messageStore.listMessages(conversation.id, 120);
    res.json({
      jobId,
      item,
      conversation: serializeConversation(updated || conversation),
      messages: messages.map(serializeMessage)
    });
  }));

  router.post("/test-message", asyncHandler(async (req, res) => {
    if (!req.body || req.body.confirm !== "local-test") {
      throw badRequest("Missing local test confirmation");
    }

    const accountId = Number(req.body.accountId);
    const chatId = String(req.body.chatId || "");
    const body = String(req.body.body || "");
    const direction = req.body.direction === "outbound" ? "outbound" : "inbound";

    if (!accountId || !isDirectChatId(chatId) || !body) {
      throw badRequest("accountId, chatId and body are required");
    }

    const messageId = `test_${direction}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const result = await messageStore.saveWhatsAppMessage(accountId, {
      id: { _serialized: messageId },
      fromMe: direction === "outbound",
      from: direction === "outbound" ? "me@s.whatsapp.net" : chatId,
      to: direction === "outbound" ? chatId : "me@s.whatsapp.net",
      body,
      type: req.body.messageType || "chat",
      timestamp: Math.floor(Date.now() / 1000),
      hasMedia: Boolean(req.body.hasMedia)
    }, {
      chatId
    });

    res.json({ result });
  }));

  return router;
}

module.exports = {
  createConversationsRouter,
  serializeConversation,
  serializeMessage
};
