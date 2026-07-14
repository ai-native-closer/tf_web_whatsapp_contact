"use strict";

const mysql = require("mysql2/promise");
const { config } = require("./config");

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.database,
      connectionLimit: config.database.connectionLimit || 10,
      charset: "utf8mb4",
      waitForConnections: true
    });
  }

  return pool;
}

async function query(sql, params) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

async function transaction(callback) {
  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  getPool,
  query,
  transaction
};

