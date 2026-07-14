"use strict";

const crypto = require("crypto");
const express = require("express");
const { asyncHandler, badRequest, notFound } = require("../http");
const { writeAudit } = require("../audit");
const { normalizePhone } = require("../phone");

function createAccountId() {
  return `wa_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function serializeAccount(row, manager) {
  return {
    id: row.id,
    accountId: row.account_id,
    clientId: row.client_id,
    displayName: row.display_name,
    phoneHint: row.phone_hint,
    status: row.status,
    loginState: row.login_state,
    isCurrent: Boolean(row.is_current),
    lastSeenAt: row.last_seen_at,
    lastQrAt: row.last_qr_at,
    disabledAt: row.disabled_at,
    deletedAt: row.deleted_at,
    remark: row.remark,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    runtime: manager.getAccountRuntime(row.id)
  };
}

async function getAccount(pool, id, includeDeleted) {
  const [rows] = await pool.execute(
    `
      SELECT *
      FROM wa_accounts
      WHERE id = ? ${includeDeleted ? "" : "AND status <> 'deleted'"}
      LIMIT 1
    `,
    [id]
  );

  if (!rows[0]) {
    throw notFound("Account not found");
  }

  return rows[0];
}

function createAccountsRouter(pool, manager) {
  const router = express.Router();

  router.get("/", asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `
        SELECT *
        FROM wa_accounts
        WHERE status <> 'deleted'
        ORDER BY is_current DESC, created_at DESC
      `
    );

    res.json({ accounts: rows.map((row) => serializeAccount(row, manager)) });
  }));

  router.post("/", asyncHandler(async (req, res) => {
    const displayName = String(req.body.displayName || "").trim();
    const phoneHint = String(req.body.phoneHint || "").trim() || null;
    const remark = String(req.body.remark || "").trim() || null;

    if (!displayName) {
      throw badRequest("Display name is required");
    }

    if (phoneHint) {
      normalizePhone(phoneHint);
    }

    const accountId = createAccountId();
    const [result] = await pool.execute(
      `
        INSERT INTO wa_accounts
          (account_id, client_id, display_name, phone_hint, remark)
        VALUES (?, ?, ?, ?, ?)
      `,
      [accountId, accountId, displayName, phoneHint, remark]
    );

    await writeAudit(pool, {
      actorUserId: req.session.user.id,
      action: "create_account",
      entityType: "wa_account",
      entityId: result.insertId,
      detail: { displayName, phoneHint }
    });

    const account = await getAccount(pool, result.insertId);
    res.status(201).json({ account: serializeAccount(account, manager) });
  }));

  router.patch("/:id", asyncHandler(async (req, res) => {
    await getAccount(pool, req.params.id);
    const displayName = String(req.body.displayName || "").trim();
    const phoneHint = String(req.body.phoneHint || "").trim() || null;
    const remark = String(req.body.remark || "").trim() || null;

    if (!displayName) {
      throw badRequest("Display name is required");
    }

    if (phoneHint) {
      normalizePhone(phoneHint);
    }

    await pool.execute(
      `
        UPDATE wa_accounts
        SET display_name = ?, phone_hint = ?, remark = ?, updated_at = NOW()
        WHERE id = ?
      `,
      [displayName, phoneHint, remark, req.params.id]
    );

    const account = await getAccount(pool, req.params.id);
    res.json({ account: serializeAccount(account, manager) });
  }));

  router.post("/:id/enable", asyncHandler(async (req, res) => {
    await getAccount(pool, req.params.id, true);
    await pool.execute(
      `
        UPDATE wa_accounts
        SET status = 'enabled', disabled_at = NULL, updated_at = NOW()
        WHERE id = ? AND status <> 'deleted'
      `,
      [req.params.id]
    );

    await writeAudit(pool, {
      actorUserId: req.session.user.id,
      action: "enable_account",
      entityType: "wa_account",
      entityId: req.params.id
    });
    const account = await getAccount(pool, req.params.id);
    res.json({ account: serializeAccount(account, manager) });
  }));

  router.post("/:id/disable", asyncHandler(async (req, res) => {
    const account = await getAccount(pool, req.params.id);

    if (manager.getCurrentAccountId() && Number(manager.getCurrentAccountId()) === Number(account.id)) {
      await manager.disconnectCurrent("disable_account");
    }

    await pool.execute(
      `
        UPDATE wa_accounts
        SET status = 'disabled', is_current = 0, disabled_at = NOW(), updated_at = NOW()
        WHERE id = ?
      `,
      [account.id]
    );

    await writeAudit(pool, {
      actorUserId: req.session.user.id,
      action: "disable_account",
      entityType: "wa_account",
      entityId: account.id
    });
    const updated = await getAccount(pool, req.params.id);
    res.json({ account: serializeAccount(updated, manager) });
  }));

  router.delete("/:id", asyncHandler(async (req, res) => {
    const account = await getAccount(pool, req.params.id);
    await manager.deleteSession(account);
    await pool.execute(
      `
        UPDATE wa_accounts
        SET status = 'deleted', is_current = 0, deleted_at = NOW(), updated_at = NOW()
        WHERE id = ?
      `,
      [account.id]
    );
    await writeAudit(pool, {
      actorUserId: req.session.user.id,
      action: "delete_account",
      entityType: "wa_account",
      entityId: account.id
    });

    res.json({ ok: true });
  }));

  router.post("/:id/switch", asyncHandler(async (req, res) => {
    const account = await getAccount(pool, req.params.id);
    const runtime = await manager.switchTo(account);
    await writeAudit(pool, {
      actorUserId: req.session.user.id,
      action: "switch_account",
      entityType: "wa_account",
      entityId: account.id
    });

    const updated = await getAccount(pool, req.params.id);
    res.json({ account: serializeAccount(updated, manager), runtime });
  }));

  router.post("/:id/login/qr", asyncHandler(async (req, res) => {
    const account = await getAccount(pool, req.params.id);
    const runtime = await manager.switchTo(account);
    res.json({ runtime });
  }));

  router.post("/:id/login/pairing-code", asyncHandler(async (req, res) => {
    const account = await getAccount(pool, req.params.id);
    const code = await manager.requestPairingCode(account, req.body.phoneNumber);
    res.json({ pairingCode: code, runtime: manager.getAccountRuntime(account.id) });
  }));

  router.get("/:id/status", asyncHandler(async (req, res) => {
    const account = await getAccount(pool, req.params.id);
    res.json({
      account: serializeAccount(account, manager),
      runtime: manager.getAccountRuntime(account.id)
    });
  }));

  return router;
}

module.exports = {
  createAccountsRouter
};

