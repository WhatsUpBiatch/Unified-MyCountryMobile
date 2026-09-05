#!/usr/bin/env node
/* Run the users.role data fix against the main database without sequelize-cli.
 *
 *   cd /var/www/prod/default-api            # or wherever .env and node_modules live
 *   ROLE_FIX_DRY_RUN=1 node run-migration.js  # report only, writes nothing
 *   node run-migration.js                     # apply
 *
 * Reads DB_HOST / DB_USER / DB_PASSWORD / DB_NAME (and DB_PORT) from the
 * environment or the .env in the current directory, the same variables
 * config/config.js uses. The migration only needs `queryInterface.sequelize.query`,
 * so a plain Sequelize instance is enough. Safe to run twice: rows already
 * holding a system key are not selected.
 */
"use strict";

const path = require("path");

try {
  require("dotenv").config();
} catch (error) {
  // dotenv is a dependency of default-api; if it is missing, the env must be set by hand.
}

const { Sequelize } = require("sequelize");

const migrationPath = process.argv[2] || path.join(__dirname, "default-api", "migrations", "20260903120000-fix-users-role-system-key.js");
const migration = require(migrationPath);

const required = ["DB_HOST", "DB_USER", "DB_NAME"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`missing environment: ${missing.join(", ")}`);
  process.exit(2);
}

const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD || "", {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  dialect: "mysql",
  logging: false,
});

(async () => {
  try {
    await sequelize.authenticate();
    const summary = await migration.up({ sequelize });
    console.log(JSON.stringify(summary));
    await sequelize.close();
    process.exit(summary.reported ? 3 : 0);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    try { await sequelize.close(); } catch (e) { /* ignore */ }
    process.exit(1);
  }
})();
