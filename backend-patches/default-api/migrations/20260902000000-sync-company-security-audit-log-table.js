"use strict";

const { syncModelByTable } = require("../scripts/migrations/syncModelByTable");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  up: async () => {
    await syncModelByTable("company_security_audit_logs");
  },

  down: async () => {
    // Intentionally no-op: table sync migration is forward-only, matching
    // every other migration in this directory (see e.g.
    // 20260612113000-sync-payment-disputes-table.js).
  },
};
