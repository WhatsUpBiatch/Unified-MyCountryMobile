// default-api: the best-effort call to campaign-api's queue/member/state.
const test = require("node:test");
const assert = require("node:assert/strict");
const m = require(`${process.env.BUILD_DIR}/QueueMembershipService.js`);
const Service = m.default;

const admin = { uuid: "admin-1", company_uuid: "co-1", db_name: "mcm_acme", role: "ADMIN", domain: "acme.mycountrymobile.com", extension: 1001, first_name: "Ann", last_name: "Admin" };

test("identity headers match what campaign-api's Auth reads", () => {
  const h = m.campaignHeaders(admin);
  assert.equal(h["X-db-name"], "mcm_acme");
  assert.equal(h["X-User-company_uuid"], "co-1");
  assert.equal(h["X-User-user_uuid"], "admin-1");
  assert.equal(h["X-User-role"], "ADMIN");
  assert.equal(h["X-User-domain"], "acme.mycountrymobile.com");
  assert.equal(h["X-User-extension"], "1001");
  assert.equal(h["X-User-username"], "Ann Admin");
  const sys = m.campaignHeaders(Service.systemActor("co-1", "mcm_acme", "acme.mycountrymobile.com"));
  assert.equal(sys["X-User-role"], "ADMIN");
  assert.equal(sys["X-User-user_uuid"], "system:person-state");
});

test("url comes from CAMPAIGN_PORT like CampaignApiService", () => {
  assert.equal(m.campaignUrl({ CAMPAIGN_PORT: "3004" }), "http://localhost:3004/api/v1/campaign/queue/member/state");
});

test("reply -> outcome", () => {
  assert.deepEqual(m.outcomeFromReply("suspend", "u1", 200, { success: true, data: { queues_touched: 2 } }), { ok: true, action: "suspend", user_uuid: "u1", queues_touched: 2 });
  assert.match(m.outcomeFromReply("suspend", "u1", 404, {}).reason, /old build/);
  assert.match(m.outcomeFromReply("suspend", "u1", 403, {}).reason, /identity headers/);
  assert.match(m.outcomeFromReply("suspend", "u1", 422, { success: false, error: { message: "action must be one of" } }).reason, /action must be/);
});

test("setMembership: posts the action, 3 s cap, returns the count; never throws", async () => {
  process.env.CAMPAIGN_PORT = "3004";
  let seen;
  global.__axios = { post: async (url, body, opts) => { seen = { url, body, opts }; return { status: 200, data: { success: true, data: { queues_touched: 3 } } }; } };
  const out = await Service.setMembership(admin, "user-9", "suspend", { extension: 1009, reason: "suspended" }, "(test)");
  assert.equal(seen.url, "http://localhost:3004/api/v1/campaign/queue/member/state");
  assert.deepEqual(seen.body, { user_uuid: "user-9", extension: "1009", action: "suspend", reason: "suspended" });
  assert.equal(seen.opts.timeout, 3000);
  assert.equal(seen.opts.headers["X-User-company_uuid"], "co-1");
  assert.deepEqual(out, { ok: true, action: "suspend", user_uuid: "user-9", queues_touched: 3 });

  global.__axios = { post: async () => { const e = new Error("timeout"); e.code = "ECONNABORTED"; throw e; } };
  const failed = await Service.setMembership(admin, "user-9", "restore");
  assert.equal(failed.ok, false); assert.equal(failed.queues_touched, 0); assert.match(failed.reason, /unreachable/);
});

test("setMembership: skipped cleanly without a port, a company, or a user", async () => {
  global.__axios = { post: async () => { throw new Error("must not be called"); } };
  delete process.env.CAMPAIGN_PORT;
  assert.match((await Service.setMembership(admin, "u", "suspend")).reason, /CAMPAIGN_PORT/);
  process.env.CAMPAIGN_PORT = "3004";
  assert.match((await Service.setMembership({ ...admin, db_name: "" }, "u", "suspend")).reason, /db_name/);
  assert.match((await Service.setMembership(admin, "", "suspend")).reason, /missing user/);
});
