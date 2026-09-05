/* Unit tests for tenant-api/src/helpers/mediaOwnership.ts (and the identical
 * default-api copy).
 *
 * Run with:  bash backend-patches/notifications-media/tests/run.sh
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const BUILD_DIR = process.env.BUILD_DIR;
if (!BUILD_DIR) throw new Error("BUILD_DIR not set; use tests/run.sh");

const {
    LIBRARY_TYPES,
    DEFAULT_LIBRARY_TYPE,
    isAdminRole,
    isLibraryType,
    normaliseLibraryType,
    libraryDeleteDecision,
    fileBelongsToCaller,
} = require(path.join(BUILD_DIR, "mediaOwnership.js"));

const admin = { uuid: "admin-uuid", role: "ADMIN" };
const agent = { uuid: "agent-uuid", role: "USER" };
const other = { uuid: "other-uuid", role: "MANAGER" };
const agentsRow = { user_uuid: "agent-uuid", is_default: false };
const stockRow = { user_uuid: null, is_default: true };

/* ---- The copies must not drift ------------------------------------------------- */

test("the two service copies of mediaOwnership.ts are identical", () => {
    const a = fs.readFileSync("/root/UCAAS/mcm-repos/tenant-api/src/helpers/mediaOwnership.ts", "utf8");
    const b = fs.readFileSync("/root/UCAAS/mcm-repos/default-api/src/helpers/mediaOwnership.ts", "utf8");
    assert.equal(a, b);
});

test("the bundle copies match the source tree", () => {
    const bundle = path.join(__dirname, "..");
    for (const svc of ["tenant-api", "default-api"]) {
        const src = fs.readFileSync(`/root/UCAAS/mcm-repos/${svc}/src/helpers/mediaOwnership.ts`, "utf8");
        const staged = fs.readFileSync(path.join(bundle, svc, "src/helpers/mediaOwnership.ts"), "utf8");
        assert.equal(staged, src, `${svc} bundle copy differs from the source tree`);
    }
});

/* ---- Types --------------------------------------------------------------------- */

test("the library is greeting / prompt / voicemail, and greeting is the default", () => {
    assert.deepEqual([...LIBRARY_TYPES], ["greeting", "prompt", "voicemail"]);
    assert.equal(DEFAULT_LIBRARY_TYPE, "greeting");
    assert.equal(isLibraryType("greeting"), true);
    assert.equal(isLibraryType(" Prompt "), true);
    assert.equal(isLibraryType("recording"), false);
    assert.equal(isLibraryType(undefined), false);
});

test("the client's type is stored when it is a library type; anything else becomes greeting", () => {
    assert.equal(normaliseLibraryType("voicemail"), "voicemail");
    assert.equal(normaliseLibraryType("PROMPT"), "prompt");
    assert.equal(normaliseLibraryType(" greeting "), "greeting");
    assert.equal(normaliseLibraryType(undefined), "greeting");
    assert.equal(normaliseLibraryType(""), "greeting");
    assert.equal(normaliseLibraryType("recording"), "greeting");
    assert.equal(normaliseLibraryType("../../etc"), "greeting");
});

/* ---- The rule ------------------------------------------------------------------ */

test("isAdminRole: the ADMIN word, case and space forgiven, nothing else", () => {
    assert.equal(isAdminRole("ADMIN"), true);
    assert.equal(isAdminRole(" admin "), true);
    assert.equal(isAdminRole("MANAGER"), false);
    assert.equal(isAdminRole("USER"), false);
    assert.equal(isAdminRole(null), false);
    assert.equal(isAdminRole(undefined), false);
});

test("an admin may delete any recording in the company", () => {
    assert.equal(libraryDeleteDecision(admin, agentsRow).allowed, true);
    assert.equal(libraryDeleteDecision(admin, { user_uuid: "other-uuid" }).allowed, true);
});

test("the person who uploaded a recording may delete it", () => {
    assert.equal(libraryDeleteDecision(agent, agentsRow).allowed, true);
    /* uuid comparison is case-insensitive and trimmed. */
    assert.equal(libraryDeleteDecision({ uuid: " AGENT-UUID ", role: "USER" }, agentsRow).allowed, true);
});

test("anyone else is refused, with a reason the screen can show", () => {
    const d = libraryDeleteDecision(other, agentsRow);
    assert.equal(d.allowed, false);
    assert.match(d.reason, /uploaded this recording, or an admin/);
});

test("stock recordings are never deleted, not even by an admin", () => {
    for (const caller of [admin, agent, other]) {
        const d = libraryDeleteDecision(caller, stockRow);
        assert.equal(d.allowed, false, `${caller.role} deleted a stock recording`);
        assert.match(d.reason, /Stock recordings/);
    }
    /* is_default arrives as 1 / "1" / "true" from some drivers. */
    assert.equal(libraryDeleteDecision(admin, { user_uuid: "admin-uuid", is_default: 1 }).allowed, false);
    assert.equal(libraryDeleteDecision(admin, { user_uuid: "admin-uuid", is_default: "1" }).allowed, false);
    assert.equal(libraryDeleteDecision(admin, { user_uuid: "admin-uuid", is_default: "true" }).allowed, false);
    assert.equal(libraryDeleteDecision(admin, { user_uuid: "admin-uuid", is_default: 0 }).allowed, true);
});

test("a file the library has no row for: admin only", () => {
    assert.equal(libraryDeleteDecision(admin, null).allowed, true);
    assert.equal(libraryDeleteDecision(admin, undefined).allowed, true);
    const d = libraryDeleteDecision(agent, null);
    assert.equal(d.allowed, false);
    assert.match(d.reason, /not in the library/);
});

test("a row with no uploader belongs to nobody but the admin", () => {
    assert.equal(libraryDeleteDecision(agent, { user_uuid: null }).allowed, false);
    assert.equal(libraryDeleteDecision(agent, { user_uuid: "" }).allowed, false);
    assert.equal(libraryDeleteDecision({ uuid: "", role: "USER" }, { user_uuid: "" }).allowed, false, "an empty caller uuid never matches an empty owner");
    assert.equal(libraryDeleteDecision(admin, { user_uuid: null }).allowed, true);
});

test("no caller at all is refused", () => {
    assert.equal(libraryDeleteDecision(null, agentsRow).allowed, false);
    assert.equal(libraryDeleteDecision({ uuid: "", role: "ADMIN" }, agentsRow).allowed, false);
});

/* ---- The company in the path --------------------------------------------------- */

test("fileBelongsToCaller: the caller's company, or the caller's own folder, nothing else", () => {
    const caller = { uuid: "person-uuid", company_uuid: "company-uuid" };
    assert.equal(fileBelongsToCaller(caller, "company-uuid"), true);
    assert.equal(fileBelongsToCaller(caller, "COMPANY-UUID"), true);
    assert.equal(fileBelongsToCaller(caller, "person-uuid"), true);
    assert.equal(fileBelongsToCaller(caller, "other-company"), false);
    assert.equal(fileBelongsToCaller(caller, ""), false);
    assert.equal(fileBelongsToCaller(caller, undefined), false);
    assert.equal(fileBelongsToCaller({ uuid: "", company_uuid: "" }, ""), false, "empty never matches empty");
});
