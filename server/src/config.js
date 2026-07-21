"use strict";

const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "../..");
const configPath = path.join(appRoot, "server/config/default.json");

const defaultConfig = {
  server: {
    port: 8003,
    sessionSecret: ""
  },
  database: {
    host: "",
    port: 3306,
    user: "",
    password: "",
    database: "",
    connectionLimit: 10
  },
  admin: {
    username: "admin",
    password: ""
  },
  whatsapp: {
    authDataPath: "./storage/baileys_auth",
    syncFullHistory: true,
    logLevel: "warn",
    reconnectBaseDelayMs: 1000,
    reconnectMaxDelayMs: 30000,
    historyRequestTimeoutMs: 15000,
    mock: false
  },
  sending: {
    defaultIntervalMs: 5000,
    minIntervalMs: 2000,
    dailyLimit: 80,
    retryLimit: 1
  },
  history: {
    windowDays: 30,
    initialSyncLimit: 100,
    olderSyncLimit: 50
  },
  leadScoring: {
    enabled: false,
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o-mini",
    timeoutMs: 15000,
    maxMessages: 40,
    maxTranscriptChars: 12000,
    debounceMs: 5000
  }
};

const environmentOverrides = [
  ["APP_SERVER_PORT", "server", "port", toNumber],
  ["APP_SESSION_SECRET", "server", "sessionSecret"],
  ["APP_DB_HOST", "database", "host"],
  ["APP_DB_PORT", "database", "port", toNumber],
  ["APP_DB_USER", "database", "user"],
  ["APP_DB_PASSWORD", "database", "password"],
  ["APP_DB_NAME", "database", "database"],
  ["APP_DB_CONNECTION_LIMIT", "database", "connectionLimit", toNumber],
  ["APP_ADMIN_USERNAME", "admin", "username"],
  ["APP_ADMIN_PASSWORD", "admin", "password"],
  ["APP_WHATSAPP_AUTH_DATA_PATH", "whatsapp", "authDataPath"],
  ["APP_WHATSAPP_SYNC_FULL_HISTORY", "whatsapp", "syncFullHistory", toBoolean],
  ["APP_WHATSAPP_LOG_LEVEL", "whatsapp", "logLevel"],
  ["APP_WHATSAPP_RECONNECT_BASE_DELAY_MS", "whatsapp", "reconnectBaseDelayMs", toNumber],
  ["APP_WHATSAPP_RECONNECT_MAX_DELAY_MS", "whatsapp", "reconnectMaxDelayMs", toNumber],
  ["APP_WHATSAPP_HISTORY_REQUEST_TIMEOUT_MS", "whatsapp", "historyRequestTimeoutMs", toNumber],
  ["APP_WHATSAPP_MOCK", "whatsapp", "mock", toBoolean],
  ["APP_SENDING_DEFAULT_INTERVAL_MS", "sending", "defaultIntervalMs", toNumber],
  ["APP_SENDING_MIN_INTERVAL_MS", "sending", "minIntervalMs", toNumber],
  ["APP_SENDING_DAILY_LIMIT", "sending", "dailyLimit", toNumber],
  ["APP_SENDING_RETRY_LIMIT", "sending", "retryLimit", toNumber],
  ["APP_HISTORY_WINDOW_DAYS", "history", "windowDays", toNumber],
  ["APP_HISTORY_INITIAL_SYNC_LIMIT", "history", "initialSyncLimit", toNumber],
  ["APP_HISTORY_OLDER_SYNC_LIMIT", "history", "olderSyncLimit", toNumber],
  ["APP_LEAD_SCORING_ENABLED", "leadScoring", "enabled", toBoolean],
  ["APP_LEAD_SCORING_BASE_URL", "leadScoring", "baseUrl"],
  ["APP_LEAD_SCORING_API_KEY", "leadScoring", "apiKey"],
  ["APP_LEAD_SCORING_MODEL", "leadScoring", "model"],
  ["APP_LEAD_SCORING_TIMEOUT_MS", "leadScoring", "timeoutMs", toNumber],
  ["APP_LEAD_SCORING_MAX_MESSAGES", "leadScoring", "maxMessages", toNumber],
  ["APP_LEAD_SCORING_MAX_TRANSCRIPT_CHARS", "leadScoring", "maxTranscriptChars", toNumber],
  ["APP_LEAD_SCORING_DEBOUNCE_MS", "leadScoring", "debounceMs", toNumber]
];

function toNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric configuration value: ${name}`);
  }

  return parsed;
}

function toBoolean(value, name) {
  if (["true", "1"].includes(value.toLowerCase())) {
    return true;
  }

  if (["false", "0"].includes(value.toLowerCase())) {
    return false;
  }

  throw new Error(`Invalid boolean configuration value: ${name}`);
}

function mergeConfig(base, overrides) {
  for (const [section, values] of Object.entries(overrides)) {
    if (values && typeof values === "object" && !Array.isArray(values)) {
      base[section] = { ...(base[section] || {}), ...values };
    } else {
      base[section] = values;
    }
  }

  return base;
}

function readConfig({ filePath = configPath, env = process.env } = {}) {
  const config = structuredClone(defaultConfig);

  if (fs.existsSync(filePath)) {
    mergeConfig(config, JSON.parse(fs.readFileSync(filePath, "utf8")));
  }

  for (const [name, section, key, parser] of environmentOverrides) {
    if (env[name] === undefined) {
      continue;
    }

    config[section][key] = parser ? parser(env[name], name) : env[name];
  }

  const required = [
    ["server", "port"],
    ["server", "sessionSecret"],
    ["database", "host"],
    ["database", "user"],
    ["database", "database"],
    ["admin", "username"],
    ["admin", "password"],
    ["whatsapp", "authDataPath"]
  ];

  for (const [section, key] of required) {
    if (!config[section] || config[section][key] === undefined || config[section][key] === "") {
      throw new Error(`Missing config value: ${section}.${key}`);
    }
  }

  if (config.leadScoring && config.leadScoring.enabled) {
    const leadRequired = [
      ["leadScoring", "baseUrl"],
      ["leadScoring", "apiKey"],
      ["leadScoring", "model"]
    ];

    for (const [section, key] of leadRequired) {
      if (!config[section] || config[section][key] === undefined || config[section][key] === "") {
        throw new Error(`Missing config value: ${section}.${key}`);
      }
    }
  }

  return config;
}

const config = readConfig();

function resolveAppPath(value) {
  if (path.isAbsolute(value)) {
    return value;
  }

  return path.resolve(appRoot, value);
}

module.exports = {
  appRoot,
  config,
  readConfig,
  resolveAppPath
};
