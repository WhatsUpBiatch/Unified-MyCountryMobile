"use strict";

/* Widen users.status so a person can be SUSPENDED.
 *
 * users.status is ENUM('EXPIRED','ACTIVE','INACTIVE','PENDING'). Until now every
 * tenant-side creation wrote ACTIVE and no tenant screen ever changed it, so
 * "suspended" did not exist as a state: setting INACTIVE by hand stopped the
 * login but the phone still registered and rang. The new state is SUSPENDED
 * and it is refused by the login, the API middleware and (once the switch
 * patches in backend-patches/person-states are applied) the phone.
 *
 * This is an explicit ALTER rather than a model sync (`syncModelByTable`)
 * because a sync rewrites every column that differs from the model, and the
 * live users table has drifted from it in places this migration must not
 * touch. The ALTER keeps the column's nullability and default exactly as they
 * are and only adds the value.
 *
 * Safe to run twice: a column that already lists SUSPENDED is left alone.
 * services/PersonStateService.ts runs the same check-and-alter on first use,
 * because migrations are not reliably run on the live boxes.
 */

const WANTED = ["EXPIRED", "ACTIVE", "INACTIVE", "PENDING", "SUSPENDED"];

/** "enum('A','B')" -> ["A","B"]. Anything that is not an enum -> null. */
function enumValues(columnType) {
  const m = /^enum\((.*)\)$/i.exec(String(columnType || "").trim());
  if (!m) return null;
  return m[1]
    .split(",")
    .map((part) => part.trim().replace(/^'(.*)'$/, "$1").replace(/''/g, "'"));
}

/** The MODIFY statement for exactly `values`, keeping nullability and default. */
function alterStatement(column, values) {
  const list = values.map((v) => "'" + String(v).replace(/'/g, "''") + "'").join(",");
  const nullable = String(column.IS_NULLABLE).toUpperCase() === "YES" ? "NULL" : "NOT NULL";
  const def =
    column.COLUMN_DEFAULT === null || column.COLUMN_DEFAULT === undefined
      ? (nullable === "NULL" ? " DEFAULT NULL" : "")
      : " DEFAULT '" + String(column.COLUMN_DEFAULT).replace(/'/g, "''") + "'";
  return "ALTER TABLE `users` MODIFY COLUMN `status` ENUM(" + list + ") " + nullable + def;
}

/** Current values plus whatever WANTED adds, in a stable order. */
function widenedValues(current) {
  return current.concat(WANTED.filter((v) => !current.includes(v)));
}

async function readColumn(sequelize) {
  const [rows] = await sequelize.query(
    "SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'status'",
  );
  return rows && rows[0] ? rows[0] : null;
}

async function up({ context }) {
  const queryInterface = context || arguments[0];
  const sequelize = queryInterface.sequelize;
  const column = await readColumn(sequelize);
  if (!column) throw new Error("users.status not found in the current database");
  const current = enumValues(column.COLUMN_TYPE);
  if (!current) {
    console.log(`[users-status-suspended] users.status is ${column.COLUMN_TYPE}, not an ENUM - nothing to widen`);
    return;
  }
  if (current.includes("SUSPENDED")) {
    console.log("[users-status-suspended] already has SUSPENDED - nothing to do");
    return;
  }
  const sql = alterStatement(column, widenedValues(current));
  console.log("[users-status-suspended] " + sql);
  await sequelize.query(sql);
}

async function down({ context }) {
  const queryInterface = context || arguments[0];
  const sequelize = queryInterface.sequelize;
  const [[{ n }]] = await sequelize.query("SELECT COUNT(*) AS n FROM `users` WHERE `status` = 'SUSPENDED'");
  if (Number(n) > 0) {
    throw new Error(`[users-status-suspended] ${n} suspended person(s) exist - reactivate them before removing the value`);
  }
  const column = await readColumn(sequelize);
  const current = enumValues(column && column.COLUMN_TYPE) || [];
  if (!current.includes("SUSPENDED")) return;
  const sql = alterStatement(column, current.filter((v) => v !== "SUSPENDED"));
  console.log("[users-status-suspended] " + sql);
  await sequelize.query(sql);
}

module.exports = {
  up: async (queryInterface) => up({ context: queryInterface }),
  down: async (queryInterface) => down({ context: queryInterface }),
  // Exported for the unit tests (backend-patches/person-states/tests).
  enumValues,
  alterStatement,
  widenedValues,
  WANTED,
};
