"use strict";

const { badRequest } = require("./http");

async function getCurrentAccount(pool, manager, requireReady) {
  const [rows] = await pool.execute(
    `
      SELECT *
      FROM wa_accounts
      WHERE is_current = 1 AND status = 'enabled'
      LIMIT 1
    `
  );
  const account = rows[0];

  if (!account) {
    throw badRequest("No active WhatsApp account is selected");
  }

  const runtime = manager.getAccountRuntime(account.id);
  if (requireReady && (!runtime || !runtime.ready)) {
    throw badRequest("Current WhatsApp account is not ready");
  }

  return { account, runtime };
}

module.exports = {
  getCurrentAccount
};

