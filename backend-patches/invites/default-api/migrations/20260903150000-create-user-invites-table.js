"use strict";

/* user_invites: one row per invite link sent to a new person.
 *
 * Main database. Only the sha256 of the token is stored; the token itself is
 * in the e-mail and nowhere else. A person may have several rows (each
 * "Resend" adds one); the newest un-accepted row is the live one.
 *
 * UserInviteService.ensureTable runs the same CREATE TABLE IF NOT EXISTS on
 * first use, so a box that never runs migrations still works. The two
 * definitions must stay identical. Idempotent: a database that already has
 * the table is left alone.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const existing = await queryInterface.showAllTables();
    const names = existing.map((t) => (typeof t === "string" ? t : t.tableName));
    if (names.includes("user_invites")) {
      return;
    }

    await queryInterface.createTable(
      "user_invites",
      {
        id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
        },
        user_uuid: { type: Sequelize.STRING(36), allowNull: false },
        company_uuid: { type: Sequelize.STRING(36), allowNull: false },
        token_hash: { type: Sequelize.CHAR(64), allowNull: false, unique: true },
        expires_at: { type: Sequelize.DATE, allowNull: false },
        accepted_at: { type: Sequelize.DATE, allowNull: true, defaultValue: null },
        created_by: { type: Sequelize.STRING(36), allowNull: true },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
      },
      {
        engine: "InnoDB",
        charset: "utf8mb4",
        collate: "utf8mb4_unicode_ci",
      },
    );
    await queryInterface.addIndex("user_invites", ["user_uuid", "created_at"], {
      name: "user_invites_user_uuid_created_at",
    });
    await queryInterface.addIndex("user_invites", ["company_uuid", "accepted_at"], {
      name: "user_invites_company_uuid_accepted_at",
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("user_invites");
  },
};
