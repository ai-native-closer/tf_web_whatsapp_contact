"use strict";

const fs = require("fs/promises");
const path = require("path");
const pino = require("pino");
const { toStoredMessage } = require("./baileys-message");
const { resolveAppPath } = require("./config");
const {
  isDirectChatId,
  normalizePhone,
  phoneFromChatId,
  toChatId
} = require("./phone");

let baileysModulePromise;

function loadBaileys() {
  if (!baileysModulePromise) {
    baileysModulePromise = import("@whiskeysockets/baileys");
  }

  return baileysModulePromise;
}

function errorMessage(error) {
  if (!error) {
    return "Unknown WhatsApp connection error";
  }

  return error.message || String(error);
}

function disconnectStatusCode(error) {
  return error && error.output && error.output.statusCode
    ? error.output.statusCode
    : error && error.statusCode;
}

function toDateFromUnix(value) {
  return new Date(Number(value || 0) * 1000);
}

class WhatsAppManager {
  constructor(pool, config, messageStore) {
    this.pool = pool;
    this.config = config;
    this.messageStore = messageStore;
    this.current = null;
    this.authDataPath = resolveAppPath(config.whatsapp.authDataPath);
    this.logger = pino({ level: config.whatsapp.logLevel || "warn" });
  }

  getCurrentAccountId() {
    return this.current ? this.current.dbId : null;
  }

  getCurrentSnapshot() {
    return this.current ? this.toSnapshot(this.current) : null;
  }

  getAccountRuntime(accountId) {
    if (!this.current || Number(this.current.dbId) !== Number(accountId)) {
      return null;
    }

    return this.toSnapshot(this.current);
  }

  toSnapshot(runtime) {
    return {
      accountId: runtime.dbId,
      accountKey: runtime.accountId,
      clientId: runtime.clientId,
      state: runtime.state,
      qr: runtime.qr || null,
      pairingCode: runtime.pairingCode || null,
      error: runtime.error || null,
      ready: runtime.state === "ready",
      startedAt: runtime.startedAt
    };
  }

  async resetBootStates() {
    await this.pool.execute(
      `
        UPDATE wa_accounts
        SET login_state = 'disconnected', is_current = 0
        WHERE login_state IN ('initializing', 'qr', 'pairing', 'authenticated', 'ready')
      `
    );
  }

  isActive(runtime, socket) {
    return this.current === runtime
      && !runtime.stopRequested
      && (!socket || runtime.socket === socket);
  }

  sessionPath(account) {
    return path.join(this.authDataPath, account.client_id);
  }

  async switchTo(account) {
    if (account.status !== "enabled") {
      throw new Error("Account must be enabled before switching");
    }

    if (this.current && Number(this.current.dbId) === Number(account.id)) {
      return this.toSnapshot(this.current);
    }

    await this.disconnectCurrent("switch_account");
    await this.pool.execute("UPDATE wa_accounts SET is_current = 0 WHERE is_current = 1");
    await this.pool.execute(
      `
        UPDATE wa_accounts
        SET is_current = 1, login_state = 'initializing', updated_at = NOW()
        WHERE id = ?
      `,
      [account.id]
    );

    const runtime = {
      dbId: account.id,
      accountId: account.account_id,
      clientId: account.client_id,
      socket: null,
      state: "initializing",
      qr: null,
      pairingCode: null,
      error: null,
      reconnectAttempts: 0,
      reconnectTimer: null,
      historyWaiters: [],
      stopRequested: false,
      startedAt: new Date().toISOString()
    };
    this.current = runtime;

    if (this.config.whatsapp.mock) {
      runtime.state = "ready";
      await this.updateAccountState(runtime, "ready");
      return this.toSnapshot(runtime);
    }

    await this.openSocket(runtime);
    return this.toSnapshot(runtime);
  }

  async openSocket(runtime) {
    if (!this.isActive(runtime)) {
      return;
    }

    try {
      const baileys = await loadBaileys();
      await fs.mkdir(this.authDataPath, { recursive: true });
      const { state, saveCreds } = await baileys.useMultiFileAuthState(
        path.join(this.authDataPath, runtime.clientId)
      );

      if (!this.isActive(runtime)) {
        return;
      }

      const socket = baileys.default({
        auth: state,
        browser: baileys.Browsers.ubuntu("WhatsApp Contact Manager"),
        logger: this.logger,
        markOnlineOnConnect: false,
        printQRInTerminal: false,
        syncFullHistory: this.config.whatsapp.syncFullHistory !== false
      });

      runtime.socket = socket;
      runtime.error = null;
      this.bindSocketEvents(runtime, socket, baileys, saveCreds);
    } catch (error) {
      if (!this.isActive(runtime)) {
        return;
      }

      runtime.state = "disconnected";
      runtime.error = errorMessage(error);
      await this.updateAccountState(runtime, "disconnected", runtime.error);
      this.scheduleReconnect(runtime);
    }
  }

  bindSocketEvents(runtime, socket, baileys, saveCreds) {
    socket.ev.on("connection.update", (update) => {
      this.handleConnectionUpdate(runtime, socket, update, baileys).catch((error) => {
        console.warn(`[whatsapp] connection update failed: ${error.message}`);
      });
    });

    socket.ev.on("creds.update", () => {
      saveCreds().catch((error) => {
        console.warn(`[whatsapp] credential save failed: ${error.message}`);
      });
    });

    socket.ev.on("messages.upsert", (update) => {
      this.handleMessagesUpsert(runtime, socket, update, baileys).catch((error) => {
        console.warn(`[whatsapp] message upsert failed: ${error.message}`);
      });
    });

    socket.ev.on("messaging-history.set", (update) => {
      this.handleHistorySet(runtime, socket, update, baileys).catch((error) => {
        console.warn(`[whatsapp] history sync failed: ${error.message}`);
      });
    });

    socket.ev.on("messaging-history.status", (update) => {
      this.handleHistoryStatus(runtime, socket, update).catch((error) => {
        console.warn(`[whatsapp] history status update failed: ${error.message}`);
      });
    });
  }

  async handleConnectionUpdate(runtime, socket, update, baileys) {
    if (!this.isActive(runtime, socket)) {
      return;
    }

    if (update.qr) {
      runtime.state = "qr";
      runtime.qr = update.qr;
      runtime.pairingCode = null;
      runtime.error = null;
      await this.updateAccountState(runtime, "qr");
    }

    if (update.isNewLogin && runtime.state !== "ready") {
      runtime.state = "authenticated";
      runtime.qr = null;
      runtime.error = null;
      await this.updateAccountState(runtime, "authenticated");
    }

    if (update.connection === "open") {
      runtime.state = "ready";
      runtime.qr = null;
      runtime.pairingCode = null;
      runtime.error = null;
      runtime.reconnectAttempts = 0;
      await this.updateAccountState(runtime, "ready");
      await this.messageStore.setAccountSyncState(runtime.dbId, "idle");
      await this.syncReadyProfile(runtime, socket);
      return;
    }

    if (update.connection !== "close") {
      return;
    }

    const error = update.lastDisconnect && update.lastDisconnect.error;
    const statusCode = disconnectStatusCode(error);
    runtime.socket = null;

    if (statusCode === baileys.DisconnectReason.loggedOut) {
      runtime.state = "logged_out";
      runtime.error = errorMessage(error);
      runtime.stopRequested = true;
      await this.updateAccountState(runtime, "logged_out", runtime.error);
      await fs.rm(path.join(this.authDataPath, runtime.clientId), { recursive: true, force: true });
      if (this.current === runtime) {
        this.current = null;
      }
      return;
    }

    runtime.state = "disconnected";
    runtime.error = errorMessage(error);
    await this.updateAccountState(runtime, "disconnected", runtime.error);
    this.scheduleReconnect(runtime);
  }

  scheduleReconnect(runtime) {
    if (!this.isActive(runtime) || runtime.reconnectTimer) {
      return;
    }

    runtime.reconnectAttempts += 1;
    const baseDelay = Number(this.config.whatsapp.reconnectBaseDelayMs) || 1000;
    const maxDelay = Number(this.config.whatsapp.reconnectMaxDelayMs) || 30000;
    const delay = Math.min(baseDelay * (2 ** (runtime.reconnectAttempts - 1)), maxDelay);

    runtime.reconnectTimer = setTimeout(() => {
      runtime.reconnectTimer = null;
      this.openSocket(runtime).catch((error) => {
        console.warn(`[whatsapp] reconnect failed: ${error.message}`);
      });
    }, delay);
  }

  async handleMessagesUpsert(runtime, socket, update, baileys) {
    if (!this.isActive(runtime, socket)) {
      return;
    }

    await this.saveBaileysMessages(runtime, socket, update.messages || [], baileys, {
      countUnread: update.type === "notify"
    });
  }

  async handleHistorySet(runtime, socket, update, baileys) {
    if (!this.isActive(runtime, socket)) {
      return;
    }

    const contactNames = {};
    for (const contact of update.contacts || []) {
      if (contact && contact.id) {
        contactNames[contact.id] = contact.name || contact.notify || contact.verifiedName || null;
      }
    }

    const saved = await this.saveBaileysMessages(runtime, socket, update.messages || [], baileys, {
      contactNames,
      countUnread: false,
      history: true
    });
    this.resolveHistoryWaiters(runtime, saved);
  }

  async handleHistoryStatus(runtime, socket, update) {
    if (!this.isActive(runtime, socket) || update.status !== "complete") {
      return;
    }

    await this.messageStore.setAccountSyncState(runtime.dbId, "idle");
  }

  async saveBaileysMessages(runtime, socket, messages, baileys, options = {}) {
    const results = [];
    for (const message of messages) {
      const stored = toStoredMessage(message, socket.user && socket.user.id, baileys);
      if (!stored || !isDirectChatId(stored.chatId)) {
        continue;
      }

      const messageDate = toDateFromUnix(stored.timestamp);
      if (options.history && !this.messageStore.isInsideHistoryWindow(messageDate)) {
        continue;
      }

      const saved = await this.saveRuntimeMessage(runtime, stored, {
        contactName: options.contactNames && options.contactNames[stored.chatId],
        countUnread: options.countUnread
      });
      results.push({
        chatId: stored.chatId,
        date: messageDate,
        inserted: Boolean(saved && saved.inserted)
      });
    }

    return results;
  }

  async updateAccountState(runtime, state, error) {
    const lastSeenSql = state === "ready" ? "last_seen_at = NOW()," : "";
    const lastQrSql = state === "qr" ? "last_qr_at = NOW()," : "";

    await this.pool.execute(
      `
        UPDATE wa_accounts
        SET login_state = ?, ${lastSeenSql} ${lastQrSql} updated_at = NOW()
        WHERE id = ?
      `,
      [state, runtime.dbId]
    );

    if (error) {
      console.warn(`[whatsapp] account ${runtime.dbId}: ${error}`);
    }
  }

  async syncReadyProfile(runtime, socket) {
    const user = socket.user || {};
    const phone = phoneFromChatId(user.id);
    const displayName = user.name ? String(user.name).trim() : null;

    if (!phone && !displayName) {
      return;
    }

    await this.pool.execute(
      `
        UPDATE wa_accounts
        SET
          phone_hint = COALESCE(phone_hint, ?),
          display_name = CASE
            WHEN display_name LIKE '扫码账号 %' AND ? IS NOT NULL AND ? <> '' THEN ?
            ELSE display_name
          END,
          updated_at = NOW()
        WHERE id = ?
      `,
      [phone, displayName, displayName, displayName, runtime.dbId]
    );
  }

  async saveRuntimeMessage(runtime, message, options) {
    if (!this.messageStore || !message) {
      return null;
    }

    return this.messageStore.saveWhatsAppMessage(runtime.dbId, message, options || {});
  }

  waitForHistory(runtime, chatId) {
    const timeoutMs = Number(this.config.whatsapp.historyRequestTimeoutMs) || 15000;
    return new Promise((resolve) => {
      const waiter = {
        chatId,
        resolve,
        timer: setTimeout(() => {
          runtime.historyWaiters = runtime.historyWaiters.filter((item) => item !== waiter);
          resolve(null);
        }, timeoutMs)
      };
      runtime.historyWaiters.push(waiter);
    });
  }

  resolveHistoryWaiters(runtime, results) {
    for (const waiter of [...runtime.historyWaiters]) {
      const matches = results.filter((item) => item.chatId === waiter.chatId);
      if (matches.length === 0) {
        continue;
      }

      clearTimeout(waiter.timer);
      runtime.historyWaiters = runtime.historyWaiters.filter((item) => item !== waiter);
      waiter.resolve({
        fetchedCount: matches.length,
        savedCount: matches.filter((item) => item.inserted).length
      });
    }
  }

  async syncOlderConversation(conversation) {
    const runtime = this.current;
    if (!runtime || runtime.state !== "ready" || Number(runtime.dbId) !== Number(conversation.account_id)) {
      throw new Error("Conversation account is not the current ready WhatsApp account");
    }

    if (this.config.whatsapp.mock) {
      return { savedCount: 0, fetchedCount: 0, hasMore: false };
    }

    if (!runtime.socket) {
      throw new Error("WhatsApp client is not initialized");
    }

    const [rows] = await this.pool.execute(
      `
        SELECT message_id, chat_id, direction, wa_timestamp
        FROM wa_messages
        WHERE conversation_id = ?
        ORDER BY wa_timestamp ASC, id ASC
        LIMIT 1
      `,
      [conversation.id]
    );
    const oldest = rows[0];
    if (!oldest) {
      await this.messageStore.setConversationSyncResult(conversation.id, null, false);
      return { savedCount: 0, fetchedCount: 0, hasMore: false };
    }

    const limit = Number(this.config.history && this.config.history.olderSyncLimit) || 50;
    const waiter = this.waitForHistory(runtime, conversation.chat_id);
    try {
      await runtime.socket.fetchMessageHistory(
        limit,
        {
          remoteJid: oldest.chat_id,
          id: oldest.message_id,
          fromMe: oldest.direction === "outbound"
        },
        Math.floor(new Date(oldest.wa_timestamp).getTime() / 1000)
      );
    } catch (error) {
      this.resolveHistoryWaiters(runtime, [{ chatId: conversation.chat_id }]);
      throw error;
    }

    const result = await waiter;
    if (!result) {
      return { savedCount: 0, fetchedCount: 0, hasMore: true };
    }

    const [cursorRows] = await this.pool.execute(
      `
        SELECT wa_timestamp
        FROM wa_messages
        WHERE conversation_id = ?
        ORDER BY wa_timestamp ASC, id ASC
        LIMIT 1
      `,
      [conversation.id]
    );
    await this.messageStore.setConversationSyncResult(
      conversation.id,
      cursorRows[0] && cursorRows[0].wa_timestamp,
      result.fetchedCount >= limit
    );

    return {
      ...result,
      hasMore: result.fetchedCount >= limit
    };
  }

  async disconnectCurrent(reason) {
    const runtime = this.current;
    if (!runtime) {
      return;
    }

    runtime.stopRequested = true;
    if (runtime.reconnectTimer) {
      clearTimeout(runtime.reconnectTimer);
      runtime.reconnectTimer = null;
    }
    for (const waiter of runtime.historyWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(null);
    }
    runtime.historyWaiters = [];
    this.current = null;

    if (runtime.socket && !this.config.whatsapp.mock) {
      try {
        await runtime.socket.end(new Error(reason || "Intentional disconnect"));
      } catch (error) {
        console.warn(`[whatsapp] socket close failed: ${error.message}`);
      }
    }

    await this.pool.execute(
      `
        UPDATE wa_accounts
        SET login_state = 'disconnected', is_current = 0, updated_at = NOW()
        WHERE id = ?
      `,
      [runtime.dbId]
    );

    if (reason) {
      console.log(`[whatsapp] disconnected account ${runtime.dbId}: ${reason}`);
    }
  }

  async deleteSession(account) {
    if (this.current && Number(this.current.dbId) === Number(account.id)) {
      await this.disconnectCurrent("delete_account");
    }

    await fs.rm(this.sessionPath(account), { recursive: true, force: true });
  }

  async requestPairingCode(account, phoneNumber) {
    await this.switchTo(account);
    const runtime = this.current;
    const normalizedPhone = normalizePhone(phoneNumber);

    if (this.config.whatsapp.mock) {
      runtime.state = "pairing";
      runtime.pairingCode = "12345678";
      await this.updateAccountState(runtime, "pairing");
      return runtime.pairingCode;
    }

    if (!runtime || !runtime.socket) {
      throw new Error("WhatsApp client is not initialized");
    }

    if (runtime.socket.authState.creds.registered) {
      throw new Error("This WhatsApp account is already registered; use QR login or remove the existing session first");
    }

    runtime.state = "pairing";
    runtime.qr = null;
    runtime.error = null;
    await this.updateAccountState(runtime, "pairing");
    const code = await runtime.socket.requestPairingCode(normalizedPhone);
    runtime.pairingCode = code;
    return code;
  }

  async sendText(phoneNumber, messageText, options) {
    const runtime = this.current;
    if (!runtime || runtime.state !== "ready") {
      throw new Error("Current WhatsApp account is not ready");
    }

    const normalizedPhone = normalizePhone(phoneNumber);
    if (this.config.whatsapp.mock) {
      const chatId = toChatId(normalizedPhone);
      const messageId = `mock_${Date.now()}`;
      await this.saveRuntimeMessage(runtime, {
        id: { _serialized: messageId },
        fromMe: true,
        from: "mock@s.whatsapp.net",
        to: chatId,
        body: messageText,
        type: "conversation",
        timestamp: Math.floor(Date.now() / 1000),
        hasMedia: false,
        chatId
      }, options);
      return { chatId, messageId };
    }

    const socket = runtime.socket;
    if (!socket) {
      throw new Error("WhatsApp client is not initialized");
    }

    const candidates = await socket.onWhatsApp(normalizedPhone);
    const recipient = candidates && candidates.find((candidate) => candidate.exists);
    if (!recipient) {
      throw new Error("Recipient is not registered on WhatsApp");
    }

    const sent = await socket.sendMessage(recipient.jid || toChatId(normalizedPhone), { text: messageText });
    if (!sent || !sent.key || !sent.key.id) {
      throw new Error("WhatsApp did not confirm message creation");
    }

    const baileys = await loadBaileys();
    const stored = toStoredMessage(sent, socket.user && socket.user.id, baileys);
    if (stored) {
      await this.saveRuntimeMessage(runtime, stored, options);
    }

    return {
      chatId: sent.key.remoteJid || recipient.jid || toChatId(normalizedPhone),
      messageId: sent.key.id
    };
  }
}

module.exports = {
  WhatsAppManager
};
