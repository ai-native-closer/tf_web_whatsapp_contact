"use strict";

const express = require("express");
const { asyncHandler, badRequest, notFound } = require("../http");
const { getCurrentAccount } = require("../current-account");
const { writeAudit } = require("../audit");

function serializeJob(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    accountName: row.account_name,
    mode: row.mode,
    status: row.status,
    messageText: row.message_text,
    intervalMs: row.interval_ms,
    dailyLimit: row.daily_limit,
    retryLimit: row.retry_limit,
    totalCount: row.total_count,
    pendingCount: row.pending_count,
    sentCount: row.sent_count,
    failedCount: row.failed_count,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeItem(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    recipientPhone: row.recipient_phone,
    contactName: row.contact_name || null,
    chatId: row.chat_id,
    status: row.status,
    attemptCount: row.attempt_count,
    messageId: row.message_id,
    errorMessage: row.error_message,
    latestReplyText: row.latest_reply_text || null,
    latestReplyAt: row.latest_reply_at || null,
    conversationId: row.conversation_id || null,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getJob(pool, id) {
  const [rows] = await pool.execute(
    `
      SELECT job.*, account.display_name AS account_name
      FROM wa_send_jobs job
      JOIN wa_accounts account ON account.id = job.account_id
      WHERE job.id = ?
      LIMIT 1
    `,
    [id]
  );

  if (!rows[0]) {
    throw notFound("Job not found");
  }

  return rows[0];
}

async function getJobDetail(pool, id) {
  const job = await getJob(pool, id);
  const [items] = await pool.execute(
    `
      SELECT
        item.*,
        conversation.contact_name,
        reply.body AS latest_reply_text,
        reply.wa_timestamp AS latest_reply_at,
        COALESCE(reply.conversation_id, conversation.id) AS conversation_id
      FROM wa_send_job_items item
      JOIN wa_send_jobs job ON job.id = item.job_id
      LEFT JOIN wa_conversations conversation
        ON conversation.account_id = job.account_id
        AND (conversation.chat_id = item.chat_id OR (item.chat_id IS NULL AND conversation.contact_phone = item.recipient_phone))
      LEFT JOIN wa_messages reply ON reply.id = (
        SELECT message.id
        FROM wa_messages message
        WHERE message.job_item_id = item.id
          AND message.direction = 'inbound'
        ORDER BY message.wa_timestamp DESC, message.id DESC
        LIMIT 1
      )
      WHERE item.job_id = ?
      ORDER BY item.id ASC
    `,
    [id]
  );

  return {
    job: serializeJob(job),
    items: items.map(serializeItem)
  };
}

function createJobsRouter(pool, manager, jobQueue, messageStore) {
  const router = express.Router();

  router.get("/", asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `
        SELECT job.*, account.display_name AS account_name
        FROM wa_send_jobs job
        JOIN wa_accounts account ON account.id = job.account_id
        ORDER BY job.created_at DESC
        LIMIT 80
      `
    );

    res.json({ jobs: rows.map(serializeJob) });
  }));

  router.post("/", asyncHandler(async (req, res) => {
    const { account } = await getCurrentAccount(pool, manager, true);
    const mode = req.body.mode === "manual" ? "manual" : "automatic";
    const jobId = await jobQueue.createJob({
      accountId: account.id,
      mode,
      messageText: req.body.messageText,
      recipients: req.body.recipients,
      intervalMs: req.body.intervalMs,
      dailyLimit: req.body.dailyLimit,
      retryLimit: req.body.retryLimit,
      createdBy: req.session.user.id
    });

    await writeAudit(pool, {
      actorUserId: req.session.user.id,
      action: "create_send_job",
      entityType: "wa_send_job",
      entityId: jobId,
      detail: { accountId: account.id, mode }
    });

    res.status(201).json(await getJobDetail(pool, jobId));
  }));

  router.get("/:id", asyncHandler(async (req, res) => {
    res.json(await getJobDetail(pool, req.params.id));
  }));

  router.post("/:id/pause", asyncHandler(async (req, res) => {
    await getJob(pool, req.params.id);
    await jobQueue.pauseJob(req.params.id, "Paused by operator");
    await writeAudit(pool, {
      actorUserId: req.session.user.id,
      action: "pause_send_job",
      entityType: "wa_send_job",
      entityId: req.params.id
    });
    res.json(await getJobDetail(pool, req.params.id));
  }));

  router.post("/:id/resume", asyncHandler(async (req, res) => {
    const job = await getJob(pool, req.params.id);
    if (job.mode !== "automatic") {
      throw badRequest("Only automatic jobs can be resumed");
    }

    await jobQueue.resumeJob(req.params.id);
    await writeAudit(pool, {
      actorUserId: req.session.user.id,
      action: "resume_send_job",
      entityType: "wa_send_job",
      entityId: req.params.id
    });
    res.json(await getJobDetail(pool, req.params.id));
  }));

  router.post("/:id/stop", asyncHandler(async (req, res) => {
    await getJob(pool, req.params.id);
    await jobQueue.stopJob(req.params.id);
    await writeAudit(pool, {
      actorUserId: req.session.user.id,
      action: "stop_send_job",
      entityType: "wa_send_job",
      entityId: req.params.id
    });
    res.json(await getJobDetail(pool, req.params.id));
  }));

  router.post("/:id/items/:itemId/send", asyncHandler(async (req, res) => {
    const job = await getJob(pool, req.params.id);
    if (job.mode !== "manual" || job.status !== "manual_waiting") {
      throw badRequest("Only waiting manual jobs can send individual items");
    }

    await getCurrentAccount(pool, manager, true);
    await jobQueue.sendItem(req.params.id, req.params.itemId);
    await writeAudit(pool, {
      actorUserId: req.session.user.id,
      action: "send_manual_job_item",
      entityType: "wa_send_job_item",
      entityId: req.params.itemId
    });
    res.json(await getJobDetail(pool, req.params.id));
  }));

  return router;
}

module.exports = {
  createJobsRouter
};
