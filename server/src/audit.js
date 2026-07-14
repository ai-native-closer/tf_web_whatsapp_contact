"use strict";

async function writeAudit(pool, entry) {
  const detail = entry.detail ? JSON.stringify(entry.detail) : null;

  await pool.execute(
    `
      INSERT INTO wa_audit_logs
        (actor_user_id, action, entity_type, entity_id, detail_json)
      VALUES (?, ?, ?, ?, ?)
    `,
    [
      entry.actorUserId || null,
      entry.action,
      entry.entityType,
      entry.entityId ? String(entry.entityId) : null,
      detail
    ]
  );
}

module.exports = {
  writeAudit
};
