"use strict";

const crypto = require("crypto");

const SYSTEM_PROMPT = `
你是一个 WhatsApp B 端招商线索分级助手。你只能根据沟通记录判断会话级线索等级。

等级规则：
- A 类：出现任一强意向信号即判 A，包括直接问入驻怎么操作、问商业条款、问平台细节、问竞品对比、主动给资料、表达时间承诺、直接表达兴趣。
- C 类：只有在没有 A 类信号时，明确拒绝、不需要、没兴趣、别再联系、答非所问、看不懂在说什么，才判 C。
- B 类：非 A 类且非 C 类。

冲突优先级：A 类信号优先于 C 类信号。比如“没兴趣，不过你们平台主要卖什么”应判 A。

只输出 JSON，不要输出解释性文字。JSON 字段：
{
  "level": "A|B|C",
  "reason": "中文简短理由",
  "evidence": ["命中的关键原文"],
  "confidence": 0.0
}
`.trim();

function normalizeOptions(config) {
  const source = config.leadScoring || {};
  return {
    enabled: Boolean(source.enabled),
    baseUrl: String(source.baseUrl || "").replace(/\/+$/, ""),
    apiKey: String(source.apiKey || ""),
    model: String(source.model || ""),
    timeoutMs: Math.max(Number(source.timeoutMs) || 15000, 1000),
    maxMessages: Math.min(Math.max(Number(source.maxMessages) || 40, 1), 120),
    maxTranscriptChars: Math.min(Math.max(Number(source.maxTranscriptChars) || 12000, 1000), 60000),
    debounceMs: Math.min(Math.max(Number(source.debounceMs) || 5000, 0), 60000)
  };
}

function toIsoString(value) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toISOString();
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }

  return Math.min(Math.max(number, 0), 1);
}

function stripJsonFence(value) {
  const text = String(value || "").trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) {
    return fenced[1].trim();
  }

  return text;
}

function parseModelJson(value) {
  const text = stripJsonFence(value);
  try {
    return JSON.parse(text);
  } catch (error) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw error;
    }

    return JSON.parse(match[0]);
  }
}

function normalizeClassification(value) {
  const data = parseModelJson(value);
  const level = String(data.level || "").trim().toUpperCase();

  if (!["A", "B", "C"].includes(level)) {
    throw new Error("Model returned an invalid lead level");
  }

  const evidence = Array.isArray(data.evidence)
    ? data.evidence
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, 8)
        .map((item) => item.slice(0, 300))
    : [];

  return {
    level,
    reason: String(data.reason || "").trim().slice(0, 1000) || "模型未返回明确理由",
    evidence,
    confidence: clampConfidence(data.confidence)
  };
}

class LeadClassifier {
  constructor(pool, config) {
    this.pool = pool;
    this.options = normalizeOptions(config);
    this.timers = new Map();
    this.queue = [];
    this.queued = new Set();
    this.running = false;
  }

  isEnabled() {
    return this.options.enabled;
  }

  async schedule(conversationId) {
    if (!this.isEnabled()) {
      return;
    }

    await this.markPending(conversationId);

    const key = Number(conversationId);
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }

    const timer = setTimeout(() => {
      this.timers.delete(key);
      this.enqueue(key);
    }, this.options.debounceMs);
    this.timers.set(key, timer);
  }

  enqueue(conversationId) {
    const key = Number(conversationId);
    if (!key || this.queued.has(key)) {
      return;
    }

    this.queued.add(key);
    this.queue.push(key);
    this.processQueue().catch((error) => {
      console.warn(`[lead-scoring] queue failed: ${error.message}`);
    });
  }

  async processQueue() {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      while (this.queue.length > 0) {
        const conversationId = this.queue.shift();
        this.queued.delete(conversationId);

        try {
          await this.scoreConversation(conversationId, { force: false, requireUnlocked: false });
        } catch (error) {
          console.warn(`[lead-scoring] conversation ${conversationId}: ${error.message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  async markPending(conversationId) {
    await this.pool.execute(
      `
        UPDATE wa_conversations
        SET lead_score_status = 'pending', lead_score_error = NULL, updated_at = NOW()
        WHERE id = ? AND lead_manual_locked = 0
      `,
      [conversationId]
    );
  }

  async getConversation(conversationId) {
    const [rows] = await this.pool.execute(
      "SELECT * FROM wa_conversations WHERE id = ? LIMIT 1",
      [conversationId]
    );

    return rows[0] || null;
  }

  async listTranscriptMessages(conversationId) {
    const [rows] = await this.pool.execute(
      `
        SELECT id, direction, body, message_type, has_media, wa_timestamp
        FROM wa_messages
        WHERE conversation_id = ?
        ORDER BY wa_timestamp DESC, id DESC
        LIMIT ${this.options.maxMessages}
      `,
      [conversationId]
    );

    return rows
      .reverse()
      .filter((row) => String(row.body || "").trim())
      .map((row) => ({
        id: row.id,
        direction: row.direction,
        body: String(row.body || "").trim(),
        messageType: row.message_type,
        timestamp: toIsoString(row.wa_timestamp)
      }));
  }

  buildTranscript(messages) {
    let text = "";
    for (const [index, message] of messages.entries()) {
      const line = `[${index + 1}] ${message.direction} ${message.timestamp}: ${message.body}\n`;
      if (text.length + line.length > this.options.maxTranscriptChars) {
        break;
      }

      text += line;
    }

    return text.trim();
  }

  signature(messages) {
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(messages))
      .digest("hex");
  }

  async scoreConversation(conversationId, options = {}) {
    if (!this.isEnabled()) {
      throw new Error("Lead scoring is disabled");
    }

    const conversation = await this.getConversation(conversationId);
    if (!conversation) {
      throw new Error("Conversation not found");
    }

    if (conversation.lead_manual_locked) {
      if (options.requireUnlocked) {
        throw new Error("Lead level is manually locked");
      }

      return conversation;
    }

    const messages = await this.listTranscriptMessages(conversationId);
    const signature = this.signature(messages);
    if (!options.force && conversation.lead_score_signature === signature && conversation.lead_score_status === "scored") {
      return conversation;
    }

    if (messages.length === 0) {
      await this.saveResult(conversationId, {
        level: "B",
        reason: "暂无可判断文本，默认 B 类",
        evidence: [],
        confidence: null
      }, signature);
      return this.getConversation(conversationId);
    }

    await this.markScoring(conversationId);

    try {
      const transcript = this.buildTranscript(messages);
      const result = await this.callModel(transcript);
      await this.saveResult(conversationId, result, signature);
    } catch (error) {
      await this.saveError(conversationId, error);
      throw error;
    }

    return this.getConversation(conversationId);
  }

  async markScoring(conversationId) {
    await this.pool.execute(
      `
        UPDATE wa_conversations
        SET lead_score_status = 'scoring', lead_score_error = NULL, updated_at = NOW()
        WHERE id = ? AND lead_manual_locked = 0
      `,
      [conversationId]
    );
  }

  async callModel(transcript) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await fetch(`${this.options.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.options.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `请判断以下 WhatsApp 沟通记录的线索等级，只返回 JSON。\n\n${transcript}`
            }
          ],
          temperature: 0,
          max_tokens: 500
        }),
        signal: controller.signal
      });

      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`Model request failed: ${response.status} ${responseText.slice(0, 500)}`);
      }

      const data = responseText ? JSON.parse(responseText) : {};
      const content = data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : "";

      if (!content) {
        throw new Error("Model returned empty content");
      }

      return normalizeClassification(content);
    } finally {
      clearTimeout(timer);
    }
  }

  async saveResult(conversationId, result, signature) {
    await this.pool.execute(
      `
        UPDATE wa_conversations
        SET
          lead_level = ?,
          lead_reason = ?,
          lead_evidence_json = ?,
          lead_confidence = ?,
          lead_score_status = 'scored',
          lead_score_error = NULL,
          lead_scored_at = NOW(),
          lead_score_signature = ?,
          updated_at = NOW()
        WHERE id = ? AND lead_manual_locked = 0
      `,
      [
        result.level,
        result.reason,
        JSON.stringify(result.evidence || []),
        result.confidence,
        signature,
        conversationId
      ]
    );
  }

  async saveError(conversationId, error) {
    await this.pool.execute(
      `
        UPDATE wa_conversations
        SET lead_score_status = 'failed', lead_score_error = ?, updated_at = NOW()
        WHERE id = ? AND lead_manual_locked = 0
      `,
      [String(error.message || error).slice(0, 2000), conversationId]
    );
  }
}

module.exports = {
  LeadClassifier
};
