"use strict";

const bcrypt = require("bcryptjs");
const express = require("express");
const { asyncHandler, requireAuth } = require("../http");
const { writeAudit } = require("../audit");

function createAuthRouter(pool) {
  const router = express.Router();

  router.post("/login", asyncHandler(async (req, res) => {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    const [rows] = await pool.execute(
      "SELECT * FROM wa_admin_users WHERE username = ? AND status = 'enabled'",
      [username]
    );
    const user = rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    req.session.user = {
      id: user.id,
      username: user.username
    };

    await pool.execute(
      "UPDATE wa_admin_users SET last_login_at = NOW(), updated_at = NOW() WHERE id = ?",
      [user.id]
    );
    await writeAudit(pool, {
      actorUserId: user.id,
      action: "login",
      entityType: "admin_user",
      entityId: user.id
    });

    res.json({ user: req.session.user });
  }));

  router.get("/me", (req, res) => {
    res.json({ user: req.session && req.session.user ? req.session.user : null });
  });

  router.post("/logout", requireAuth, (req, res, next) => {
    const userId = req.session.user.id;
    req.session.destroy((error) => {
      if (error) {
        next(error);
        return;
      }

      writeAudit(pool, {
        actorUserId: userId,
        action: "logout",
        entityType: "admin_user",
        entityId: userId
      }).catch(() => {});
      res.clearCookie("connect.sid");
      res.json({ ok: true });
    });
  });

  return router;
}

module.exports = {
  createAuthRouter
};
