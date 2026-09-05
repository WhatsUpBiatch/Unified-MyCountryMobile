"use strict";

/* users.pronouns VARCHAR(40) NULL and users.interface_language VARCHAR(10) NULL.
 *
 * Both are read and written only by /api/profile/self and /update-self
 * (src/services/ProfileSelfService.ts). They are deliberately NOT on the User
 * model, so nothing else in the API selects them and a build can run before
 * this migration without breaking login (see that file for why).
 *
 * Safe to run twice: each column is added only if `users` does not have it.
 * `down` removes only the columns this migration added, and only if present.
 */

const COLUMNS = [
  { name: "pronouns", type: "VARCHAR(40)" },
  { name: "interface_language", type: "VARCHAR(10)" },
];

async function presentColumns(queryInterface) {
  const described = await queryInterface.describeTable("users");
  return new Set(Object.keys(described || {}).map((c) => c.toLowerCase()));
}

async function up(queryInterface) {
  const have = await presentColumns(queryInterface);
  for (const col of COLUMNS) {
    if (have.has(col.name)) {
      console.log(`[users-pronouns-language] users.${col.name} already present, skipped`);
      continue;
    }
    await queryInterface.sequelize.query(`ALTER TABLE \`users\` ADD COLUMN \`${col.name}\` ${col.type} NULL`);
    console.log(`[users-pronouns-language] added users.${col.name}`);
  }
}

async function down(queryInterface) {
  const have = await presentColumns(queryInterface);
  for (const col of COLUMNS) {
    if (!have.has(col.name)) continue;
    await queryInterface.sequelize.query(`ALTER TABLE \`users\` DROP COLUMN \`${col.name}\``);
    console.log(`[users-pronouns-language] dropped users.${col.name}`);
  }
}

module.exports = { up, down, COLUMNS };
