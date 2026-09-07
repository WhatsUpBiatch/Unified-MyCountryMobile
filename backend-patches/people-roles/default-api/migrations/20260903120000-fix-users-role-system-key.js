"use strict";

/* One-off data fix: make users.role hold a system role key.
 *
 * users.role is free text. Custom roles used to copy their NAME into it, and
 * some screens wrote a raw uuid, so live rows hold "Custom Sub-Admin", "New
 * role", uuids, and so on. Every server-side check compares that column against
 * "ADMIN" / "AGENT" / "MANAGER", so those rows are either locked out of things
 * they should see or (for a custom role NAMED "ADMIN") let in everywhere.
 *
 * For every row whose users.role is not already one of the four keys, this
 * works out the right key from the ids the row carries and writes it:
 *
 *   1. custom_role_uuid -> custom_roles.role_uuid -> roles.name (the parent)
 *   2. role_uuid        -> roles.name (must be a PREDEFINED system role)
 *   3. users.role is itself a uuid of a custom role or a system role -> as 1/2,
 *      and role_uuid / custom_role_uuid are filled in from it
 *   4. users.role is a key with wrong case or spacing ("admin", " Agent ",
 *      "SUB_ADMIN") -> normalised
 *
 * A row that resolves to nothing is REPORTED and left alone. Every change is
 * logged with the old and new value. Running it twice changes nothing the
 * second time: rows already holding a key are not selected.
 *
 * Soft-deleted rows are included: they can be restored within 72 hours and
 * would otherwise come back with the old value.
 *
 * `down` is deliberately a no-op. The old values are in the migration log,
 * and putting free text back into the column would reopen the hole.
 */

const SYSTEM_ROLE_KEYS = ["ADMIN", "SUB-ADMIN", "MANAGER", "AGENT"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normaliseSystemRole(value) {
  const key = String(value == null ? "" : value).trim().toUpperCase().replace(/_/g, "-");
  return SYSTEM_ROLE_KEYS.includes(key) ? key : null;
}

/**
 * Pure: decide what one row should become.
 *
 * @param row      { uuid, role, role_uuid, custom_role_uuid }
 * @param lookup   { systemByUuid: Map<uuid, KEY>, customByUuid: Map<uuid, { role_uuid, company_uuid }> }
 * @returns        { action: "skip" } | { action: "report", reason }
 *                 | { action: "update", role, role_uuid?, custom_role_uuid?, via }
 */
function resolveRow(row, lookup) {
  if (normaliseSystemRole(row.role) === String(row.role || "")) {
    return { action: "skip" };
  }

  const systemKeyFor = (roleUuid) => lookup.systemByUuid.get(String(roleUuid || "").trim()) || null;

  // 1. custom role -> parent system role
  if (row.custom_role_uuid) {
    const custom = lookup.customByUuid.get(String(row.custom_role_uuid).trim());
    if (custom) {
      if (custom.company_uuid && row.company_uuid && String(custom.company_uuid) !== String(row.company_uuid)) {
        return { action: "report", reason: `custom_role_uuid ${row.custom_role_uuid} belongs to another company` };
      }
      const key = systemKeyFor(custom.role_uuid);
      if (key) return { action: "update", role: key, role_uuid: String(custom.role_uuid), via: "custom_role_uuid" };
      return { action: "report", reason: `custom role ${row.custom_role_uuid} has parent ${custom.role_uuid} which is not a system role` };
    }
    // fall through: a dangling custom_role_uuid should not stop role_uuid from working
  }

  // 2. role_uuid -> system role
  if (row.role_uuid) {
    const key = systemKeyFor(row.role_uuid);
    if (key) return { action: "update", role: key, via: "role_uuid" };
  }

  // 3. users.role holds a uuid
  const text = String(row.role == null ? "" : row.role).trim();
  if (UUID_RE.test(text)) {
    const key = systemKeyFor(text);
    if (key) return { action: "update", role: key, role_uuid: text, custom_role_uuid: null, via: "role text is a system role uuid" };
    const custom = lookup.customByUuid.get(text);
    if (custom) {
      const parentKey = systemKeyFor(custom.role_uuid);
      if (parentKey) {
        return { action: "update", role: parentKey, role_uuid: String(custom.role_uuid), custom_role_uuid: text, via: "role text is a custom role uuid" };
      }
      return { action: "report", reason: `role text is custom role ${text} whose parent ${custom.role_uuid} is not a system role` };
    }
  }

  // 4. a key with the wrong case or spacing
  const normalised = normaliseSystemRole(text);
  if (normalised) return { action: "update", role: normalised, via: "normalised text" };

  return { action: "report", reason: `cannot resolve role "${text}" (role_uuid=${row.role_uuid || "-"}, custom_role_uuid=${row.custom_role_uuid || "-"})` };
}

async function loadLookup(queryInterface) {
  const [systemRows] = await queryInterface.sequelize.query(
    "SELECT uuid, name FROM roles WHERE company_uuid = 'PREDEFINED'",
  );
  const systemByUuid = new Map();
  for (const r of systemRows) {
    const key = normaliseSystemRole(r.name);
    if (key) systemByUuid.set(String(r.uuid), key);
  }

  const [customRows] = await queryInterface.sequelize.query(
    "SELECT uuid, role_uuid, company_uuid FROM custom_roles",
  );
  const customByUuid = new Map();
  for (const r of customRows) {
    customByUuid.set(String(r.uuid), { role_uuid: r.role_uuid, company_uuid: r.company_uuid });
  }

  return { systemByUuid, customByUuid };
}

async function up(queryInterface) {
  /* ROLE_FIX_DRY_RUN=1 logs every decision and writes nothing. Run it first. */
  const dryRun = /^(1|true|yes)$/i.test(String(process.env.ROLE_FIX_DRY_RUN || ""));
  const lookup = await loadLookup(queryInterface);
  if (lookup.systemByUuid.size === 0) {
    throw new Error("fix-users-role-system-key: no PREDEFINED system roles found in `roles`; refusing to run");
  }

  const placeholders = SYSTEM_ROLE_KEYS.map(() => "?").join(", ");
  const [rows] = await queryInterface.sequelize.query(
    `SELECT uuid, company_uuid, role, role_uuid, custom_role_uuid, deleted_at
       FROM users
      WHERE role IS NULL OR BINARY role NOT IN (${placeholders})`,
    { replacements: SYSTEM_ROLE_KEYS },
  );

  const summary = { selected: rows.length, updated: 0, reported: 0, skipped: 0 };
  const reported = [];

  for (const row of rows) {
    const decision = resolveRow(row, lookup);
    if (decision.action === "skip") {
      summary.skipped++;
      continue;
    }
    if (decision.action === "report") {
      summary.reported++;
      reported.push({ uuid: row.uuid, company_uuid: row.company_uuid, role: row.role, reason: decision.reason });
      console.warn(`[fix-users-role] REPORT user ${row.uuid} (company ${row.company_uuid}): ${decision.reason}`);
      continue;
    }

    const sets = ["role = ?"];
    const values = [decision.role];
    if (decision.role_uuid !== undefined) {
      sets.push("role_uuid = ?");
      values.push(decision.role_uuid);
    }
    if (decision.custom_role_uuid !== undefined) {
      sets.push("custom_role_uuid = ?");
      values.push(decision.custom_role_uuid);
    }
    values.push(row.uuid);

    if (!dryRun) {
      await queryInterface.sequelize.query(
        `UPDATE users SET ${sets.join(", ")} WHERE uuid = ?`,
        { replacements: values },
      );
    }
    summary.updated++;
    console.log(
      `[fix-users-role] ${dryRun ? "WOULD UPDATE" : "UPDATE"} user ${row.uuid} (company ${row.company_uuid}${row.deleted_at ? ", soft-deleted" : ""}): ` +
        `role "${row.role}" -> "${decision.role}"` +
        (decision.role_uuid !== undefined ? `, role_uuid ${row.role_uuid || "-"} -> ${decision.role_uuid}` : "") +
        (decision.custom_role_uuid !== undefined ? `, custom_role_uuid ${row.custom_role_uuid || "-"} -> ${decision.custom_role_uuid}` : "") +
        ` (via ${decision.via})`,
    );
  }

  console.log(`[fix-users-role] ${dryRun ? "DRY RUN " : ""}done: ${JSON.stringify(summary)}`);
  if (reported.length) {
    console.warn(`[fix-users-role] ${reported.length} row(s) left untouched - fix by hand:\n` + JSON.stringify(reported, null, 2));
  }
  return summary;
}

module.exports = {
  up,
  down: async () => {
    // Intentionally no-op: the old free-text values are in the migration log.
  },
  // Exported for the unit tests (backend-patches/people-roles/tests).
  resolveRow,
  normaliseSystemRole,
  SYSTEM_ROLE_KEYS,
};
