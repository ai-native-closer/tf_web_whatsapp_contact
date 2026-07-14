"use strict";

const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "../..");
const configPath = path.join(appRoot, "server/config/default.json");

function readConfig() {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing config file: ${configPath}`);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
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
  resolveAppPath
};
