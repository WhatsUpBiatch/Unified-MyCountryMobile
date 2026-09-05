// default-api: the best-effort call to esl-manager.
const test = require("node:test");
const assert = require("node:assert/strict");
const m = require(`${process.env.BUILD_DIR}/RegistrationKickService.js`);
const Service = m.default;

test("domain from the company's db_name, the way AuthMiddleware does it", () => {
  assert.equal(m.domainFromDbName("mcm_1757576519531", ".mycountrymobile.com"), "1757576519531.mycountrymobile.com");
  assert.equal(m.domainFromDbName("mcm_acme", "@mycountrymobile.com"), "acme.mycountrymobile.com", "an @ in the suffix becomes a dot");
  assert.equal(m.domainFromDbName("", ".x"), "");
  assert.equal(m.domainFromDbName(null, ".x"), "");
});

test("request shape and refusal of anything that is not an extension@domain", () => {
  assert.deepEqual(m.kickRequest(1000, "X.MyCountryMobile.com"), { extension: "1000", domain: "x.mycountrymobile.com" });
  assert.equal(m.kickRequest("", "x.com"), null);
  assert.equal(m.kickRequest("1000", ""), null);
  assert.equal(m.kickRequest("1000 reboot", "x.com"), null);
});

test("esl-manager url defaults to loopback 5555 and honours ESL_MANAGER_URL", () => {
  assert.equal(m.eslManagerUrl({}), "http://127.0.0.1:5555");
  assert.equal(m.eslManagerUrl({ ESL_MANAGER_URL: "http://10.0.0.2:5555/" }), "http://10.0.0.2:5555");
});

test("reply -> outcome: ok, partial, old build, bad token", () => {
  const ok = m.outcomeFromReply("1000", "x.com", 200, { ok: true, flushed: ["1000", "1000_web"], found: [{}, {}] });
  assert.equal(ok.ok, true); assert.equal(ok.found, 2); assert.deepEqual(ok.flushed, ["1000", "1000_web"]);
  const partial = m.outcomeFromReply("1000", "x.com", 200, { ok: false, flushed: ["1000"], found: [], failed: [{ user: "1000_web", reply: "-ERR" }] });
  assert.equal(partial.ok, false); assert.match(partial.reason, /1000_web: -ERR/);
  assert.match(m.outcomeFromReply("1000", "x.com", 404, "Cannot POST").reason, /old build/);
  assert.match(m.outcomeFromReply("1000", "x.com", 401, {}).reason, /token/);
  assert.match(m.outcomeFromReply("1000", "x.com", 500, {}).reason, /HTTP 500/);
});

test("kickRegistration: posts extension+domain with a 3 s cap and returns the outcome", async () => {
  let seen;
  global.__axios = { post: async (url, body, opts) => { seen = { url, body, opts }; return { status: 200, data: { ok: true, flushed: ["1000", "1000_web"], found: [{}] } }; } };
  const out = await Service.kickRegistration("1000", "x.com", "(test)");
  assert.equal(seen.url, "http://127.0.0.1:5555/registrations/flush");
  assert.deepEqual(seen.body, { extension: "1000", domain: "x.com" });
  assert.equal(seen.opts.timeout, 3000);
  assert.equal(out.ok, true);
  assert.deepEqual(out.flushed, ["1000", "1000_web"]);
});

test("kickRegistration: never throws - timeout, refused connection, old build", async () => {
  global.__axios = { post: async () => { const e = new Error("timeout of 3000ms exceeded"); e.code = "ECONNABORTED"; throw e; } };
  let out = await Service.kickRegistration("1000", "x.com");
  assert.equal(out.ok, false); assert.match(out.reason, /ECONNABORTED/);

  global.__axios = { post: async () => { const e = new Error("connect ECONNREFUSED"); e.code = "ECONNREFUSED"; throw e; } };
  out = await Service.kickRegistration("1000", "x.com");
  assert.equal(out.ok, false); assert.match(out.reason, /unreachable/);

  global.__axios = { post: async () => ({ status: 404, data: "Cannot POST /registrations/flush" }) };
  out = await Service.kickRegistration("1000", "x.com");
  assert.equal(out.ok, false); assert.match(out.reason, /redeploy/);

  global.__axios = { post: async () => { throw new Error("must not be called"); } };
  out = await Service.kickRegistration("", "x.com");
  assert.equal(out.ok, false); assert.match(out.reason, /no extension/);
});

test("kickRegistration: sends the bearer token only when configured", async () => {
  let headers;
  global.__axios = { post: async (_u, _b, opts) => { headers = opts.headers; return { status: 200, data: { ok: true, flushed: [], found: [] } }; } };
  delete process.env.ESL_MANAGER_API_TOKEN;
  await Service.kickRegistration("1000", "x.com");
  assert.equal(headers.Authorization, undefined);
  process.env.ESL_MANAGER_API_TOKEN = "s3cret";
  await Service.kickRegistration("1000", "x.com");
  assert.equal(headers.Authorization, "Bearer s3cret");
  delete process.env.ESL_MANAGER_API_TOKEN;
});
