"use strict";

const { isDirectChatId, phoneFromChatId } = require("./phone");

function toDateFromUnix(value) {
  const timestamp = Number(value || 0);
  if (!timestamp) {
    return new Date();
  }

  return new Date(timestamp * 1000);
}

function toMysqlDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function normalizeMessageId(message) {
  if (!message || !message.id) {
    return null;
  }

  return message.id._serialized || message.id.id || null;
}

function chatIdFromMessage(message) {
  if (message.fromMe) {
    return message.to || message.from;
  }

  return message.from || message.to;
}

function serializeMediaMetadata(message) {
  if (!message || !message.hasMedia) {
    return null;
  }

  const metadata = {
    mediaKey: message.mediaKey || null,
    duration: message.duration || null,
    isGif: Boolean(message.isGif),
    isViewOnce: Boolean(message.isViewOnce),
    hasMedia: Boolean(message.hasMedia)
  };

  return message.mediaMetadata || JSON.stringify(metadata);
}

function messageSummary(message) {
  const body = String(message.body || "").trim();
  if (body) {
    return body.slice(0, 500);
  }

  if (message.hasMedia) {
    return `[${message.type || "media"}]`;
  }

  return `[${message.type || "message"}]`;
}

class MessageStore {
  constructor(pool, config) {
    this.pool = pool;
    this.config = config;
    this.leadClassifier = null;
  }

  setLeadClassifier(leadClassifier) {
    this.leadClassifier = leadClassifier;
  }

  scheduleLeadScore(conversationId) {
    if (!this.leadClassifier || !this.leadClassifier.isEnabled()) {
      return;
    }

    this.leadClassifier.schedule(conversationId).catch((error) => {
      console.warn(`[lead-scoring] schedule failed: ${error.message}`);
    });
  }

  historyCutoffDate() {
    const days = Number(this.config.history && this.config.history.windowDays) || 30;
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  isInsideHistoryWindow(messageDate) {
    return messageDate >= this.historyCutoffDate();
  }

  async upsertConversation(accountId, chatId, options = {}) {
    const phone = options.contactPhone || phoneFromChatId(chatId);
    const name = options.contactName || null;

    await this.pool.execute(
      `
        INSERT INTO wa_conversations
          (account_id, chat_id, contact_phone, contact_name, has_more)
        VALUES (?, ?, ?, ?, 1)
        ON DUPLICATE KEY UPDATE
          contact_phone = COALESCE(VALUES(contact_phone), contact_phone),
          contact_name = COALESCE(VALUES(contact_name), contact_name)
      `,
      [accountId, chatId, phone, name]
    );

    const [rows] = await this.pool.execute(
      "SELECT * FROM wa_conversations WHERE account_id = ? AND chat_id = ?",
      [accountId, chatId]
    );

    return rows[0];
  }

  async resolveMappedChatId(accountId, chatId) {
    if (!String(chatId || "").endsWith("@lid")) {
      return chatId;
    }

    const [rows] = await this.pool.execute(
      `SELECT phone_chat_id
       FROM wa_lid_mappings
       WHERE account_id = ? AND lid_chat_id = ?
       LIMIT 1`,
      [accountId, chatId]
    );

    return rows[0]?.phone_chat_id || chatId;
  }

  async saveWhatsAppMessage(accountId, message, options = {}) {
    const messageId = normalizeMessageId(message);
    const originalChatId = options.chatId || chatIdFromMessage(message);
    const chatId = await this.resolveMappedChatId(accountId, originalChatId);
    if (!messageId || !chatId || !isDirectChatId(chatId)) {
      return null;
    }

    const waDate = toDateFromUnix(message.timestamp);
    const direction = message.fromMe ? "outbound" : "inbound";
    const conversation = await this.upsertConversation(accountId, chatId, {
      contactPhone: phoneFromChatId(chatId),
      contactName: options.contactName || null
    });
    const body = message.body === undefined || message.body === null ? null : String(message.body);
    const metadata = serializeMediaMetadata(message);

    const [result] = await this.pool.execute(
      `
        INSERT IGNORE INTO wa_messages
          (account_id, conversation_id, message_id, chat_id, sender_id, recipient_id,
           direction, message_type, body, has_media, media_mime_type, media_filename,
           media_size, media_metadata, wa_timestamp, job_id, job_item_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        accountId,
        conversation.id,
        messageId,
        chatId,
        message.from || null,
        message.to || null,
        direction,
        message.type || "chat",
        body,
        message.hasMedia ? 1 : 0,
        message.mimetype || null,
        message.filename || null,
        message.size || null,
        metadata,
        toMysqlDate(waDate),
        options.jobId || null,
        options.jobItemId || null
      ]
    );

    if (result.affectedRows > 0) {
      await this.updateConversationFromMessage(
        conversation.id,
        message,
        waDate,
        direction,
        options.countUnread !== false
      );

      if (direction === "inbound") {
        await this.linkInboundToRecentJob(accountId, chatId, conversation.id, messageId);
      }

      this.scheduleLeadScore(conversation.id);
    }

    return {
      inserted: result.affectedRows > 0,
      conversationId: conversation.id,
      messageId
    };
  }

  async updateConversationFromMessage(conversationId, message, waDate, direction, countUnread) {
    const hasOriginalTimestamp = !message.timestampEstimated;

    await this.pool.execute(
      `
        UPDATE wa_conversations
        SET
          last_message_text = CASE WHEN ? AND (last_message_at IS NULL OR last_message_at <= ?) THEN ? ELSE last_message_text END,
          last_message_type = CASE WHEN ? AND (last_message_at IS NULL OR last_message_at <= ?) THEN ? ELSE last_message_type END,
          last_message_direction = CASE WHEN ? AND (last_message_at IS NULL OR last_message_at <= ?) THEN ? ELSE last_message_direction END,
          last_message_at = CASE WHEN ? AND (last_message_at IS NULL OR last_message_at <= ?) THEN ? ELSE last_message_at END,
          unread_count = unread_count + ?,
          history_cursor_at = CASE
            WHEN ? AND (history_cursor_at IS NULL OR history_cursor_at > ?) THEN ?
            ELSE history_cursor_at
          END,
          updated_at = NOW()
        WHERE id = ?
      `,
      [
        hasOriginalTimestamp,
        toMysqlDate(waDate),
        messageSummary(message),
        hasOriginalTimestamp,
        toMysqlDate(waDate),
        message.type || "chat",
        hasOriginalTimestamp,
        toMysqlDate(waDate),
        direction,
        hasOriginalTimestamp,
        toMysqlDate(waDate),
        toMysqlDate(waDate),
        direction === "inbound" && countUnread ? 1 : 0,
        hasOriginalTimestamp,
        toMysqlDate(waDate),
        toMysqlDate(waDate),
        conversationId
      ]
    );
  }

  async linkInboundToRecentJob(accountId, chatId, conversationId, messageId) {
    const [rows] = await this.pool.execute(
      `
        SELECT item.id AS job_item_id, item.job_id
        FROM wa_send_job_items item
        JOIN wa_send_jobs job ON job.id = item.job_id
        WHERE job.account_id = ?
          AND item.chat_id = ?
          AND item.status = 'sent'
        ORDER BY item.sent_at DESC
        LIMIT 1
      `,
      [accountId, chatId]
    );
    const link = rows[0];

    if (!link) {
      return;
    }

    await this.pool.execute(
      `
        UPDATE wa_messages
        SET job_id = ?, job_item_id = ?, updated_at = NOW()
        WHERE account_id = ? AND conversation_id = ? AND message_id = ? AND direction = 'inbound'
      `,
      [link.job_id, link.job_item_id, accountId, conversationId, messageId]
    );
  }

  async listConversations(accountId) {
    const params = [];
    let where = "account.status <> 'deleted'";

    if (accountId) {
      where += " AND conversation.account_id = ?";
      params.push(accountId);
    }

    const [rows] = await this.pool.execute(
      `
        SELECT
          conversation.*,
          account.display_name AS account_name
        FROM wa_conversations conversation
        JOIN wa_accounts account ON account.id = conversation.account_id
        WHERE ${where}
        ORDER BY conversation.last_message_at DESC, conversation.id DESC
        LIMIT 200
      `,
      params
    );

    return rows;
  }

  async listReachRows(accountId) {
    const params = [];
    let where = "account.status <> 'deleted'";

    if (accountId) {
      where += " AND conversation.account_id = ?";
      params.push(accountId);
    }

    const [rows] = await this.pool.execute(
      `
        SELECT
          conversation.id AS conversation_id,
          conversation.account_id,
          account.display_name AS account_name,
          account.phone_hint AS own_whatsapp_phone,
          conversation.last_message_at AS updated_at,
          conversation.chat_id,
          conversation.contact_phone,
          conversation.contact_name,
          first_outbound.first_outbound_at
        FROM wa_conversations conversation
        JOIN wa_accounts account ON account.id = conversation.account_id
        LEFT JOIN (
          SELECT conversation_id, MIN(wa_timestamp) AS first_outbound_at
          FROM wa_messages
          WHERE direction = 'outbound'
          GROUP BY conversation_id
        ) first_outbound ON first_outbound.conversation_id = conversation.id
        WHERE ${where}
        ORDER BY conversation.last_message_at DESC, conversation.id DESC
        LIMIT 500
      `,
      params
    );

    return rows;
  }

  async getConversation(id) {
    const [rows] = await this.pool.execute(
      `
        SELECT
          conversation.*,
          account.display_name AS account_name
        FROM wa_conversations conversation
        JOIN wa_accounts account ON account.id = conversation.account_id
        WHERE conversation.id = ?
        LIMIT 1
      `,
      [id]
    );

    return rows[0] || null;
  }

  async listMessages(conversationId, limit) {
    const safeLimit = Math.min(Math.max(Number(limit) || 120, 1), 1000);
    const [rows] = await this.pool.execute(
      `
        SELECT *
        FROM wa_messages
        WHERE conversation_id = ?
        ORDER BY wa_timestamp DESC, id DESC
        LIMIT ${safeLimit}
      `,
      [conversationId]
    );

    return rows.reverse();
  }

  async markConversationRead(conversationId) {
    await this.pool.execute(
      "UPDATE wa_conversations SET unread_count = 0, updated_at = NOW() WHERE id = ?",
      [conversationId]
    );
  }

  async setContactName(conversationId, contactName) {
    await this.pool.execute(
      `
        UPDATE wa_conversations
        SET contact_name = ?, updated_at = NOW()
        WHERE id = ?
      `,
      [contactName || null, conversationId]
    );

    return this.getConversation(conversationId);
  }

  async setManualLeadLevel(conversationId, level, note, userId, manualLocked) {
    const normalizedLevel = String(level || "").trim().toUpperCase();
    const normalizedNote = String(note || "").trim() || null;
    const locked = manualLocked ? 1 : 0;
    const status = locked ? "manual" : "unscored";
    const reason = normalizedNote ? `人工设置：${normalizedNote}` : "人工设置";

    await this.pool.execute(
      `
        UPDATE wa_conversations
        SET
          lead_level = ?,
          lead_reason = ?,
          lead_evidence_json = ?,
          lead_confidence = NULL,
          lead_score_status = ?,
          lead_score_error = NULL,
          lead_scored_at = NOW(),
          lead_score_signature = NULL,
          lead_manual_locked = ?,
          lead_manual_note = ?,
          lead_manual_user_id = ?,
          lead_manual_at = NOW(),
          updated_at = NOW()
        WHERE id = ?
      `,
      [
        normalizedLevel,
        reason,
        JSON.stringify([]),
        status,
        locked,
        normalizedNote,
        userId || null,
        conversationId
      ]
    );

    return this.getConversation(conversationId);
  }

  async unlockManualLeadLevel(conversationId, userId) {
    await this.pool.execute(
      `
        UPDATE wa_conversations
        SET
          lead_manual_locked = 0,
          lead_score_status = CASE WHEN lead_score_status = 'manual' THEN 'unscored' ELSE lead_score_status END,
          lead_manual_user_id = ?,
          lead_manual_at = NOW(),
          updated_at = NOW()
        WHERE id = ?
      `,
      [userId || null, conversationId]
    );

    return this.getConversation(conversationId);
  }

  async setConversationSyncResult(conversationId, oldestDate, hasMore) {
    await this.pool.execute(
      `
        UPDATE wa_conversations
        SET history_cursor_at = ?, has_more = ?, last_synced_at = NOW(), updated_at = NOW()
        WHERE id = ?
      `,
      [oldestDate ? toMysqlDate(oldestDate) : null, hasMore ? 1 : 0, conversationId]
    );
  }

  async applyLidMapping(accountId, lidChatId, phoneChatId) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `INSERT INTO wa_lid_mappings (account_id, lid_chat_id, phone_chat_id)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE phone_chat_id = VALUES(phone_chat_id)`,
        [accountId, lidChatId, phoneChatId]
      );
      const [rows] = await connection.execute(
        `SELECT * FROM wa_conversations WHERE account_id = ? AND chat_id IN (?, ?) FOR UPDATE`,
        [accountId, lidChatId, phoneChatId]
      );
      const lid = rows.find((row) => row.chat_id === lidChatId);
      const phone = rows.find((row) => row.chat_id === phoneChatId);
      if (lid && phone && lid.id !== phone.id) {
        await connection.execute("UPDATE wa_messages SET conversation_id = ?, chat_id = ? WHERE conversation_id = ?", [phone.id, phoneChatId, lid.id]);
        await connection.execute("UPDATE wa_send_job_items SET chat_id = ? WHERE job_id IN (SELECT id FROM wa_send_jobs WHERE account_id = ?) AND chat_id = ?", [phoneChatId, accountId, lidChatId]);
        await connection.execute("UPDATE wa_conversations SET unread_count = unread_count + ?, updated_at = NOW() WHERE id = ?", [lid.unread_count, phone.id]);
        await connection.execute("DELETE FROM wa_conversations WHERE id = ?", [lid.id]);
      } else if (lid && !phone) {
        await connection.execute("UPDATE wa_conversations SET chat_id = ?, contact_phone = COALESCE(contact_phone, ?) WHERE id = ?", [phoneChatId, phoneFromChatId(phoneChatId), lid.id]);
        await connection.execute("UPDATE wa_messages SET chat_id = ? WHERE conversation_id = ?", [phoneChatId, lid.id]);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  }

  async setAccountSyncState(accountId, status, error) {
    await this.pool.execute(
      `
        INSERT INTO wa_message_sync_state
          (account_id, status, last_initial_sync_at, last_error)
        VALUES (?, ?, IF(? = 'idle', NOW(), NULL), ?)
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          last_initial_sync_at = IF(VALUES(status) = 'idle', NOW(), last_initial_sync_at),
          last_error = VALUES(last_error),
          updated_at = NOW()
      `,
      [accountId, status, status, error || null]
    );
  }
}

module.exports = {
  MessageStore,
  chatIdFromMessage,
  normalizeMessageId,
  phoneFromChatId,
  toMysqlDate
};
