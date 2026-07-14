"use strict";

const bcrypt = require("bcryptjs");

async function bootstrapAdmin(pool, config) {
  const [rows] = await pool.execute(
    "SELECT id FROM wa_admin_users WHERE username = ?",
    [config.admin.username]
  );

  if (rows.length > 0) {
    return;
  }

  const passwordHash = await bcrypt.hash(config.admin.password, 10);
  await pool.execute(
    "INSERT INTO wa_admin_users (username, password_hash, status) VALUES (?, ?, 'enabled')",
    [config.admin.username, passwordHash]
  );
}

module.exports = {
  bootstrapAdmin
};

