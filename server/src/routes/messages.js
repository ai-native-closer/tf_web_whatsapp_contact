"use strict";

const express = require("express");
const { asyncHandler } = require("../http");
const { getCurrentAccount } = require("../current-account");
const { writeAudit } = require("../audit");

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

function createMessagesRouter(pool, manager, jobQueue) {
  const router = express.Router();

  router.post("/send", asyncHandler(async (req, res) => {
    const { account } = await getCurrentAccount(pool, manager, true);
    const jobId = await jobQueue.createSingleSend(
      account.id,
      req.body.phoneNumber,
      req.body.messageText,
      req.session.user.id
    );
    const item = await getSingleResult(pool, jobId);

    await writeAudit(pool, {
      actorUserId: req.session.user.id,
      action: "send_single_message",
      entityType: "wa_send_job",
      entityId: jobId,
      detail: {
        accountId: account.id,
        status: item ? item.status : null,
        recipientPhone: item ? item.recipient_phone : null
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

    res.json({ jobId, item });
  }));

  return router;
}

module.exports = {
  createMessagesRouter
};

