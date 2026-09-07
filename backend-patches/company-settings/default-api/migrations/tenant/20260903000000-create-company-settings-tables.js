"use strict";

/* company_settings: one row per company-wide settings section, versioned, with a
 * history table that gets a row on every save.
 *
 * This file runs for NEW tenant databases (TenantDatabaseService runs every file in
 * this directory when a company's database is created). Existing tenant databases
 * never re-run migrations, so tenant-api creates the same two tables itself the
 * first time it touches them (src/repositories/CompanySettingsRepository.ts,
 * ensureCompanySettingsTables). The two definitions must stay identical.
 *
 * Idempotent: a database that already has the tables (because tenant-api got there
 * first) is left alone.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const existing = await queryInterface.showAllTables();
    const names = existing.map((t) => (typeof t === "string" ? t : t.tableName));

    if (!names.includes("company_settings")) {
      await queryInterface.createTable("company_settings", {
        id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
        },
        section: {
          type: Sequelize.STRING(64),
          allowNull: false,
          unique: true,
        },
        settings: {
          type: Sequelize.JSON,
          allowNull: false,
        },
        version: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: false,
          defaultValue: 1,
        },
        updated_by: {
          type: Sequelize.STRING(36),
          allowNull: true,
        },
        updated_by_name: {
          type: Sequelize.STRING(120),
          allowNull: true,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.fn("now"),
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.fn("now"),
          onUpdate: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
      }, {
        engine: "InnoDB",
        charset: "utf8mb4",
        collate: "utf8mb4_unicode_ci",
      });
    }

    if (!names.includes("company_settings_history")) {
      await queryInterface.createTable("company_settings_history", {
        id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
        },
        section: {
          type: Sequelize.STRING(64),
          allowNull: false,
        },
        settings: {
          type: Sequelize.JSON,
          allowNull: false,
        },
        version: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: false,
        },
        changed_by: {
          type: Sequelize.STRING(36),
          allowNull: true,
        },
        changed_by_name: {
          type: Sequelize.STRING(120),
          allowNull: true,
        },
        changed_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.fn("now"),
        },
      }, {
        engine: "InnoDB",
        charset: "utf8mb4",
        collate: "utf8mb4_unicode_ci",
      });
      await queryInterface.addIndex("company_settings_history", ["section", "changed_at"], {
        name: "company_settings_history_section",
      });
    }
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("company_settings_history");
    await queryInterface.dropTable("company_settings");
  },
};
