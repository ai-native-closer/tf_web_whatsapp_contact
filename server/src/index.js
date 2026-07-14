"use strict";

const cookieParser = require("cookie-parser");
const express = require("express");
const session = require("express-session");
const fs = require("fs");
const path = require("path");
const { appRoot, config } = require("./config");
const { bootstrapAdmin } = require("./bootstrap");
const { createAccountsRouter } = require("./routes/accounts");
const { createAuthRouter } = require("./routes/auth");
const { createConversationsRouter } = require("./routes/conversations");
const { createJobsRouter } = require("./routes/jobs");
const { createMessagesRouter } = require("./routes/messages");
const { getPool } = require("./db");
const { JobQueue } = require("./job-queue");
const { LeadClassifier } = require("./lead-classifier");
const { MessageStore } = require("./message-store");
const { runMigrations } = require("./migrate");
const { requireAuth } = require("./http");
const { WhatsAppManager } = require("./whatsapp-manager");

async function createApp() {
  await runMigrations();
  const pool = getPool();
  await bootstrapAdmin(pool, config);

  const leadClassifier = new LeadClassifier(pool, config);
  const messageStore = new MessageStore(pool, config);
  messageStore.setLeadClassifier(leadClassifier);
  const manager = new WhatsAppManager(pool, config, messageStore);
  await manager.resetBootStates();
  const jobQueue = new JobQueue(pool, manager, config);
  const app = express();

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use(session({
    secret: config.server.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 8
    }
  }));

  app.get("/api/health", async (req, res) => {
    await pool.execute("SELECT 1");
    res.json({
      ok: true,
      currentAccount: manager.getCurrentSnapshot()
    });
  });

  app.use("/api/auth", createAuthRouter(pool));
  app.use("/api/accounts", requireAuth, createAccountsRouter(pool, manager));
  app.use("/api/messages", requireAuth, createMessagesRouter(pool, manager, jobQueue));
  app.use("/api/jobs", requireAuth, createJobsRouter(pool, manager, jobQueue, messageStore));
  app.use("/api/conversations", requireAuth, createConversationsRouter(pool, manager, messageStore, jobQueue, leadClassifier));

  const frontendDist = path.join(appRoot, "frontend/dist");
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get("*", (req, res) => {
      res.sendFile(path.join(frontendDist, "index.html"));
    });
  } else {
    app.get("/", (req, res) => {
      res.status(503).send("Frontend is not built. Run npm run build first.");
    });
  }

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      console.error(error);
    }

    res.status(statusCode).json({
      error: error.message || "Internal server error"
    });
  });

  jobQueue.kick();
  return app;
}

if (require.main === module) {
  createApp()
    .then((app) => {
      app.listen(config.server.port, () => {
        console.log(`WhatsApp contact manager listening on http://localhost:${config.server.port}`);
      });
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  createApp
};
