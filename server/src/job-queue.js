"use strict";

const { parseRecipients } = require("./phone");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class JobQueue {
  constructor(pool, manager, config) {
    this.pool = pool;
    this.manager = manager;
    this.config = config;
    this.running = false;
  }

  sanitizeInterval(value) {
    const min = this.config.sending.minIntervalMs || 2000;
    const fallback = this.config.sending.defaultIntervalMs || 5000;
    const interval = Number(value || fallback);
    return Math.max(min, interval);
  }

  sanitizeDailyLimit(value) {
    const fallback = this.config.sending.dailyLimit || 80;
    const limit = Number(value || fallback);
    return Math.max(1, Math.min(10000, limit));
  }

  sanitizeRetryLimit(value) {
    const fallback = this.config.sending.retryLimit || 1;
    const retryLimit = Number(value === undefined ? fallback : value);
    return Math.max(0, Math.min(5, retryLimit));
  }

  async createJob(options) {
    const recipients = parseRecipients(options.recipients);
    if (recipients.length === 0) {
      throw new Error("At least one recipient is required");
    }

    const messageText = String(options.messageText || "").trim();
    if (!messageText) {
      throw new Error("Message text is required");
    }

    const mode = options.mode === "manual" ? "manual" : "automatic";
    const status = mode === "manual" ? "manual_waiting" : "queued";
    const intervalMs = this.sanitizeInterval(options.intervalMs);
    const dailyLimit = this.sanitizeDailyLimit(options.dailyLimit);
    const retryLimit = this.sanitizeRetryLimit(options.retryLimit);

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [jobResult] = await connection.execute(
        `
          INSERT INTO wa_send_jobs
            (account_id, mode, status, message_text, interval_ms, daily_limit,
             retry_limit, total_count, pending_count, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          options.accountId,
          mode,
          status,
          messageText,
          intervalMs,
          dailyLimit,
          retryLimit,
          recipients.length,
          recipients.length,
          options.createdBy || null
        ]
      );

      for (const phone of recipients) {
        await connection.execute(
          "INSERT INTO wa_send_job_items (job_id, recipient_phone) VALUES (?, ?)",
          [jobResult.insertId, phone]
        );
      }

      await connection.commit();
      if (mode === "automatic") {
        this.kick();
      }

      return jobResult.insertId;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async createSingleSend(accountId, phoneNumber, messageText, createdBy) {
    const recipients = parseRecipients([phoneNumber]);
    const text = String(messageText || "").trim();
    if (!text) {
      throw new Error("Message text is required");
    }

    const connection = await this.pool.getConnection();
    let jobId;
    let itemId;

    try {
      await connection.beginTransaction();
      const [jobResult] = await connection.execute(
        `
          INSERT INTO wa_send_jobs
            (account_id, mode, status, message_text, interval_ms, daily_limit,
             retry_limit, total_count, pending_count, created_by, started_at)
          VALUES (?, 'single', 'running', ?, ?, ?, 0, 1, 1, ?, NOW())
        `,
        [
          accountId,
          text,
          this.sanitizeInterval(),
          this.sanitizeDailyLimit(),
          createdBy || null
        ]
      );
      jobId = jobResult.insertId;

      const [itemResult] = await connection.execute(
        "INSERT INTO wa_send_job_items (job_id, recipient_phone) VALUES (?, ?)",
        [jobId, recipients[0]]
      );
      itemId = itemResult.insertId;
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await this.sendItem(jobId, itemId);
    return jobId;
  }

  async kick() {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      while (true) {
        const job = await this.nextAutomaticJob();
        if (!job) {
          break;
        }

        await this.pool.execute(
          `
            UPDATE wa_send_jobs
            SET status = 'running', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
            WHERE id = ? AND status = 'queued'
          `,
          [job.id]
        );

        const currentJob = await this.getJob(job.id);
        if (!currentJob || currentJob.status !== "running") {
          continue;
        }

        const item = await this.nextPendingItem(job.id);
        if (!item) {
          await this.completeJobIfDone(job.id);
          continue;
        }

        const canSendToday = await this.canSendToday(currentJob);
        if (!canSendToday) {
          await this.pauseJob(job.id, "Daily sending limit reached");
          continue;
        }

        await this.sendItem(job.id, item.id);
        await sleep(currentJob.interval_ms);
      }
    } finally {
      this.running = false;
    }
  }

  async nextAutomaticJob() {
    const [rows] = await this.pool.execute(
      `
        SELECT *
        FROM wa_send_jobs
        WHERE mode = 'automatic' AND status IN ('queued', 'running')
        ORDER BY created_at ASC
        LIMIT 1
      `
    );

    return rows[0] || null;
  }

  async getJob(jobId) {
    const [rows] = await this.pool.execute(
      "SELECT * FROM wa_send_jobs WHERE id = ?",
      [jobId]
    );

    return rows[0] || null;
  }

  async nextPendingItem(jobId) {
    const [rows] = await this.pool.execute(
      `
        SELECT *
        FROM wa_send_job_items
        WHERE job_id = ? AND status = 'pending'
        ORDER BY id ASC
        LIMIT 1
      `,
      [jobId]
    );

    return rows[0] || null;
  }

  async canSendToday(job) {
    const [rows] = await this.pool.execute(
      `
        SELECT COUNT(*) AS sent_count
        FROM wa_send_job_items item
        JOIN wa_send_jobs job ON job.id = item.job_id
        WHERE job.account_id = ?
          AND item.status = 'sent'
          AND item.sent_at >= CURRENT_DATE()
      `,
      [job.account_id]
    );

    return Number(rows[0].sent_count) < Number(job.daily_limit);
  }

  async sendItem(jobId, itemId) {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new Error("Job not found");
    }

    const [items] = await this.pool.execute(
      "SELECT * FROM wa_send_job_items WHERE id = ? AND job_id = ?",
      [itemId, jobId]
    );
    const item = items[0];
    if (!item || item.status !== "pending") {
      return;
    }

    const currentAccountId = this.manager.getCurrentAccountId();
    if (Number(currentAccountId) !== Number(job.account_id)) {
      await this.pauseJob(job.id, "Job account is not the current active WhatsApp account");
      return;
    }

    await this.pool.execute(
      `
        UPDATE wa_send_job_items
        SET status = 'sending', attempt_count = attempt_count + 1, updated_at = NOW()
        WHERE id = ?
      `,
      [item.id]
    );

    try {
      const result = await this.manager.sendText(item.recipient_phone, job.message_text, {
        jobId: job.id,
        jobItemId: item.id
      });
      await this.pool.execute(
        `
          UPDATE wa_send_job_items
          SET status = 'sent', chat_id = ?, message_id = ?, sent_at = NOW(), updated_at = NOW()
          WHERE id = ?
        `,
        [result.chatId, result.messageId, item.id]
      );
    } catch (error) {
      const retryable = Number(item.attempt_count) < Number(job.retry_limit);
      await this.pool.execute(
        `
          UPDATE wa_send_job_items
          SET status = ?, error_message = ?, updated_at = NOW()
          WHERE id = ?
        `,
        [retryable ? "pending" : "failed", error.message, item.id]
      );
    }

    await this.refreshCounts(job.id);
    await this.completeJobIfDone(job.id);
  }

  async pauseJob(jobId, reason) {
    await this.pool.execute(
      `
        UPDATE wa_send_jobs
        SET status = 'paused', error_message = ?, updated_at = NOW()
        WHERE id = ? AND status IN ('queued', 'running')
      `,
      [reason || null, jobId]
    );
  }

  async resumeJob(jobId) {
    await this.pool.execute(
      `
        UPDATE wa_send_jobs
        SET status = 'queued', error_message = NULL, updated_at = NOW()
        WHERE id = ? AND mode = 'automatic' AND status = 'paused'
      `,
      [jobId]
    );
    this.kick();
  }

  async stopJob(jobId) {
    await this.pool.execute(
      `
        UPDATE wa_send_jobs
        SET status = 'stopped', finished_at = NOW(), updated_at = NOW()
        WHERE id = ? AND status IN ('queued', 'running', 'paused', 'manual_waiting')
      `,
      [jobId]
    );
    await this.pool.execute(
      `
        UPDATE wa_send_job_items
        SET status = 'canceled', updated_at = NOW()
        WHERE job_id = ? AND status = 'pending'
      `,
      [jobId]
    );
    await this.refreshCounts(jobId);
  }

  async refreshCounts(jobId) {
    await this.pool.execute(
      `
        UPDATE wa_send_jobs
        SET
          pending_count = (
            SELECT COUNT(*) FROM wa_send_job_items
            WHERE job_id = ? AND status IN ('pending', 'sending')
          ),
          sent_count = (
            SELECT COUNT(*) FROM wa_send_job_items
            WHERE job_id = ? AND status = 'sent'
          ),
          failed_count = (
            SELECT COUNT(*) FROM wa_send_job_items
            WHERE job_id = ? AND status = 'failed'
          ),
          updated_at = NOW()
        WHERE id = ?
      `,
      [jobId, jobId, jobId, jobId]
    );
  }

  async completeJobIfDone(jobId) {
    const [rows] = await this.pool.execute(
      `
        SELECT
          job.*,
          SUM(CASE WHEN item.status IN ('pending', 'sending') THEN 1 ELSE 0 END) AS open_count,
          SUM(CASE WHEN item.status = 'failed' THEN 1 ELSE 0 END) AS failed_items
        FROM wa_send_jobs job
        LEFT JOIN wa_send_job_items item ON item.job_id = job.id
        WHERE job.id = ?
        GROUP BY job.id
      `,
      [jobId]
    );
    const job = rows[0];

    if (!job || Number(job.open_count) > 0) {
      return;
    }

    if (["stopped", "completed", "failed"].includes(job.status)) {
      return;
    }

    await this.pool.execute(
      `
        UPDATE wa_send_jobs
        SET status = ?, finished_at = NOW(), updated_at = NOW()
        WHERE id = ?
      `,
      [Number(job.failed_items) > 0 ? "failed" : "completed", jobId]
    );
  }
}

module.exports = {
  JobQueue
};
