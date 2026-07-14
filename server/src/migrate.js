"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { appRoot, config } = require("./config");

const migrationsDir = path.join(appRoot, "server/db/migration");

function splitStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function runMigrations() {
  const connection = await mysql.createConnection({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    charset: "utf8mb4"
  });

  try {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS wa_schema_migrations (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        version VARCHAR(180) NOT NULL,
        checksum CHAR(64) NOT NULL,
        executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_wa_schema_migrations_version (version)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => /^V\d+__.+\.sql$/.test(file))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      const checksum = crypto.createHash("sha256").update(sql).digest("hex");
      const [existing] = await connection.execute(
        "SELECT id, checksum FROM wa_schema_migrations WHERE version = ?",
        [file]
      );

      if (existing.length > 0) {
        if (existing[0].checksum !== checksum) {
          throw new Error(`Migration checksum changed after execution: ${file}`);
        }

        continue;
      }

      await connection.beginTransaction();
      try {
        for (const statement of splitStatements(sql)) {
          await connection.query(statement);
        }

        await connection.execute(
          "INSERT INTO wa_schema_migrations (version, checksum) VALUES (?, ?)",
          [file, checksum]
        );
        await connection.commit();
        console.log(`Migrated ${file}`);
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log("Migrations complete");
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  runMigrations
};

