// default-api: the User model hook that runs the follow-ups after a removal commits.
const test = require("node:test");
const assert = require("node:assert/strict");
const m = require(`${process.env.BUILD_DIR}/PersonRemovalHooks.js`);
const Hooks = m.default;

const tick = () => new Promise((r) => setImmediate(r));

test("targetFromWhere: one uuid, with or without company; nothing for a company-wide destroy", () => {
  assert.deepEqual(m.targetFromWhere({ uuid: "u1", company_uuid: "c1" }), { uuid: "u1", company_uuid: "c1" });
  assert.deepEqual(m.targetFromWhere({ uuid: " u1 " }), { uuid: "u1", company_uuid: null });
  assert.equal(m.targetFromWhere({ company_uuid: "c1" }), null);
  assert.equal(m.targetFromWhere({ uuid: ["u1", "u2"] }), null);
  assert.equal(m.targetFromWhere(undefined), null);
});

test("afterBulkDestroy: waits for the transaction to commit, then kicks the phone and marks the queues", async () => {
  process.env.CAMPAIGN_PORT = "3004";
  process.env.DOMAIN_SUFFIX = ".mycountrymobile.com";
  const posts = [];
  global.__axios = { post: async (url, body, opts) => { posts.push({ url, body, headers: opts.headers }); return { status: 200, data: url.includes("5555") ? { ok: true, flushed: ["1009", "1009_web"], found: [] } : { success: true, data: { queues_touched: 1 } } }; } };
  const queries = [];
  global.__sequelize = { query: async (sql, opts) => { queries.push({ sql, opts }); return [[{ uuid: "u9", company_uuid: "c1", extension: 1009, db_name: "mcm_acme" }]]; } };

  let committed = null;
  const transaction = { afterCommit: (fn) => { committed = fn; } };
  Hooks.afterBulkDestroy({ where: { uuid: "u9", company_uuid: "c1" }, transaction });
  assert.equal(typeof committed, "function", "registered on afterCommit");
  assert.equal(posts.length, 0, "nothing happens before the commit");

  committed();
  await tick(); await tick(); await tick();
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /LEFT JOIN companies/);
  assert.deepEqual(queries[0].opts.replacements, { uuid: "u9", company_uuid: "c1" });
  assert.equal(posts.length, 2);
  const kick = posts.find((p) => p.url.includes("5555"));
  const membership = posts.find((p) => p.url.includes("queue/member/state"));
  assert.deepEqual(kick.body, { extension: "1009", domain: "acme.mycountrymobile.com" });
  assert.deepEqual(membership.body, { user_uuid: "u9", extension: "1009", action: "suspend", reason: "removed" });
  assert.equal(membership.headers["X-User-company_uuid"], "c1");
  assert.equal(membership.headers["X-db-name"], "mcm_acme");
});

test("afterBulkDestroy: no transaction -> next tick; hooks:false and company-wide destroys are ignored; never throws", async () => {
  const posts = [];
  global.__axios = { post: async (url, body) => { posts.push({ url, body }); return { status: 200, data: { ok: true, flushed: [], found: [], success: true, data: {} } }; } };
  global.__sequelize = { query: async () => [[{ uuid: "u9", company_uuid: "c1", extension: 1009, db_name: "mcm_acme" }]] };
  Hooks.afterBulkDestroy({ where: { uuid: "u9" } });
  await tick(); await tick(); await tick();
  assert.equal(posts.length, 2);

  posts.length = 0;
  Hooks.afterBulkDestroy({ where: { uuid: "u9" }, hooks: false });
  Hooks.afterBulkDestroy({ where: { company_uuid: "c1" } });
  Hooks.afterBulkDestroy(null);
  await tick(); await tick();
  assert.equal(posts.length, 0);

  global.__sequelize = { query: async () => { throw new Error("db down"); } };
  assert.doesNotThrow(() => Hooks.afterBulkDestroy({ where: { uuid: "u9" } }));
  await tick(); await tick();
  assert.equal(posts.length, 0, "a failed lookup means no follow-ups and no throw");
});
