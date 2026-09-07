/* Unit tests for tenant-api/src/helpers/notificationSettings.ts (and the identical
 * default-api copy).
 *
 * Run with:  bash backend-patches/notifications-media/tests/run.sh
 * The build dir is passed in BUILD_DIR. No database, no network.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const BUILD_DIR = process.env.BUILD_DIR;
if (!BUILD_DIR) throw new Error("BUILD_DIR not set; use tests/run.sh");

const {
    NOTIFICATION_EVENTS,
    flattenNotificationSettings,
    isLegacyNestedShape,
    notificationSettingsForSend,
    channelsCarriedByPayload,
    smsRecipientFor,
    normaliseChannelChoice,
    asChannelFlag,
} = require(path.join(BUILD_DIR, "notificationSettings.js"));

/* What the website's Notifications page posts (src/pages/settings/notification/index.tsx). */
const pageBody = () => ({
    notification_settings: {
        voicemail: { email: true, socket: true, sms: false, push: true, phone: "" },
        missed: { email: false, socket: true, sms: true, push: false, phone: "+15551234567" },
        sms: { email: false, socket: true, sms: false, push: true, phone: "" },
        forgot_password: { email: true, socket: false, sms: true, push: false },
    },
});

const flat = () => pageBody().notification_settings;

/* ---- The copies must not drift ------------------------------------------------- */

test("the two service copies of notificationSettings.ts are identical", () => {
    const a = fs.readFileSync("/root/UCAAS/mcm-repos/tenant-api/src/helpers/notificationSettings.ts", "utf8");
    const b = fs.readFileSync("/root/UCAAS/mcm-repos/default-api/src/helpers/notificationSettings.ts", "utf8");
    assert.equal(a, b);
});

test("the bundle copies match the source tree", () => {
    const bundle = path.join(__dirname, "..");
    for (const svc of ["tenant-api", "default-api"]) {
        const src = fs.readFileSync(`/root/UCAAS/mcm-repos/${svc}/src/helpers/notificationSettings.ts`, "utf8");
        const staged = fs.readFileSync(path.join(bundle, svc, "src/helpers/notificationSettings.ts"), "utf8");
        assert.equal(staged, src, `${svc} bundle copy differs from the source tree`);
    }
});

/* ---- flatten: every shape that is in the data or on the wire ------------------- */

test("the flat shape passes through unchanged (booleans coerced, phone kept)", () => {
    assert.deepEqual(flattenNotificationSettings(flat()), flat());
});

test("the old one-level wrapper the website posted is peeled", () => {
    assert.deepEqual(flattenNotificationSettings(pageBody()), flat());
    assert.equal(isLegacyNestedShape(pageBody()), true);
    assert.equal(isLegacyNestedShape(flat()), false);
});

test("a wrapper inside a wrapper (double save) is peeled too; five deep is not a settings object", () => {
    assert.deepEqual(flattenNotificationSettings({ notification_settings: pageBody() }), flat());
    let deep = flat();
    for (let i = 0; i < 5; i += 1) deep = { notification_settings: deep };
    assert.equal(flattenNotificationSettings(deep), null);
});

test("JSON text is accepted at the top and inside the wrapper", () => {
    assert.deepEqual(flattenNotificationSettings(JSON.stringify(pageBody())), flat());
    assert.deepEqual(flattenNotificationSettings(JSON.stringify(flat())), flat());
    assert.deepEqual(flattenNotificationSettings({ notification_settings: JSON.stringify(flat()) }), flat());
});

test("nothing usable is null: null, undefined, empty, text, a general settings object", () => {
    assert.equal(flattenNotificationSettings(null), null);
    assert.equal(flattenNotificationSettings(undefined), null);
    assert.equal(flattenNotificationSettings(""), null);
    assert.equal(flattenNotificationSettings("not json"), null);
    assert.equal(flattenNotificationSettings(42), null);
    assert.equal(flattenNotificationSettings([]), null);
    assert.equal(flattenNotificationSettings({}), null);
    assert.equal(flattenNotificationSettings({ notification_settings: {} }), null);
    assert.equal(flattenNotificationSettings({ notification_settings: null }), null);
    /* A person's general `settings` blob: voicemail_pin, recording, ... none of these
       is a channel choice, so it is not mistaken for notification choices. */
    assert.equal(
        flattenNotificationSettings({ voicemail_pin: { value: "1234" }, recording: { automatic: { enabled: true } }, transcription: true }),
        null,
    );
});

test("only entries that look like a channel choice survive; extra events are kept", () => {
    const out = flattenNotificationSettings({
        voicemail: { email: "true", socket: 0, sms: "no", push: 1 },
        security_alert: { email: true, socket: true, sms: false, push: true },
        label: "not a choice",
        missed: "off",
        stray: { nested: { email: true } },
    });
    assert.deepEqual(out, {
        voicemail: { email: true, socket: false, sms: false, push: true },
        security_alert: { email: true, socket: true, sms: false, push: true },
    });
    assert.ok(NOTIFICATION_EVENTS.includes("voicemail"));
});

test("a person whose only event is called notification_settings is not unwrapped into it", () => {
    /* Contrived, but the unwrap must stop when a real event is present. */
    const odd = { voicemail: { email: true }, notification_settings: { email: false } };
    assert.deepEqual(flattenNotificationSettings(odd), { voicemail: { email: true, socket: false, sms: false, push: false } });
});

test("channel flags: true/1/'1'/'yes'/'true' are on, everything else off; phone is trimmed text", () => {
    assert.equal(asChannelFlag(true), true);
    assert.equal(asChannelFlag(1), true);
    assert.equal(asChannelFlag("1"), true);
    assert.equal(asChannelFlag(" yes "), true);
    assert.equal(asChannelFlag("TRUE"), true);
    assert.equal(asChannelFlag(false), false);
    assert.equal(asChannelFlag(0), false);
    assert.equal(asChannelFlag("no"), false);
    assert.equal(asChannelFlag(null), false);
    assert.equal(asChannelFlag(undefined), false);
    assert.deepEqual(normaliseChannelChoice({ email: "yes", phone: " +1 555 " }), { email: true, socket: false, sms: false, push: false, phone: "+1 555" });
    assert.deepEqual(normaliseChannelChoice({ email: true, phone: null }), { email: true, socket: false, sms: false, push: false });
});

test("flatten never mutates its input", () => {
    const input = pageBody();
    const snapshot = JSON.stringify(input);
    flattenNotificationSettings(input);
    assert.equal(JSON.stringify(input), snapshot);
});

/* ---- What notification-api receives ---------------------------------------- */

/* The voicemail payload tenant-api builds (CallListRepository.sendVoicemail). */
const voicemailPayload = () => ({
    type: "voicemail",
    email_notification: { service_type: "SENDGRID", data: {} },
    socket_notification: { service_type: "SOCKET", data: {} },
    sms_notification: { service_type: "TELNYX", data: {} },
    device_notification: { service_type: "FIREBASE", data: {} },
});

test("the person's own choice is what notification-api gets, from either stored shape", () => {
    const expected = { email: true, socket: true, sms: false, push: true, phone: "" };
    assert.deepEqual(notificationSettingsForSend(flat(), "voicemail", voicemailPayload()).voicemail, expected);
    assert.deepEqual(notificationSettingsForSend(pageBody(), "voicemail", voicemailPayload()).voicemail, expected);
    assert.deepEqual(notificationSettingsForSend(JSON.stringify(pageBody()), "voicemail", voicemailPayload()).voicemail, expected);
    /* The other events ride along untouched: notification-api reads by type name. */
    assert.deepEqual(notificationSettingsForSend(flat(), "voicemail", voicemailPayload()).missed, flat().missed);
});

test("an event the person never chose gets every channel the payload carries", () => {
    /* The rule default-api's SmsController has always applied. A person who never
       opened the Notifications page keeps getting voicemail emails. */
    assert.deepEqual(notificationSettingsForSend(null, "voicemail", voicemailPayload()), {
        voicemail: { email: true, socket: true, sms: true, push: true },
    });
    const socketOnly = { type: "voicemail", socket_notification: { data: {} }, email_notification: null, sms_notification: null };
    assert.deepEqual(notificationSettingsForSend(undefined, "voicemail", socketOnly), {
        voicemail: { email: false, socket: true, sms: false, push: false },
    });
    /* `push_notification` is the older key for the same channel. */
    assert.deepEqual(channelsCarriedByPayload({ push_notification: {} }), { email: false, socket: false, sms: false, push: true });
    /* Chose other events but not this one: same fallback for this one only. */
    const out = notificationSettingsForSend({ missed: { email: true } }, "voicemail", socketOnly);
    assert.deepEqual(out.voicemail, { email: false, socket: true, sms: false, push: false });
    assert.deepEqual(out.missed, { email: true, socket: false, sms: false, push: false });
});

test("a caller may supply its own rule for the unset case", () => {
    const silent = { email: false, socket: false, sms: false, push: false };
    assert.deepEqual(notificationSettingsForSend(null, "voicemail", voicemailPayload(), silent), { voicemail: silent });
    /* ...but a stored choice still wins over it. */
    assert.deepEqual(notificationSettingsForSend(flat(), "voicemail", voicemailPayload(), silent).voicemail, flat().voicemail);
});

test("the result always has the event key, so notification-api never answers 'not found for type'", () => {
    for (const raw of [null, undefined, "", {}, { notification_settings: {} }, flat(), pageBody(), "garbage"]) {
        const out = notificationSettingsForSend(raw, "voicemail", voicemailPayload());
        assert.ok(out && typeof out.voicemail === "object", `missing voicemail key for ${JSON.stringify(raw)}`);
        for (const channel of ["email", "socket", "sms", "push"]) {
            assert.equal(typeof out.voicemail[channel], "boolean", `${channel} is not a boolean for ${JSON.stringify(raw)}`);
        }
    }
});

test("this is the shape notification-api's validator and reader accept", () => {
    /* Joi: notification_settings must be an object (schema/Notification.ts). Reader:
       notificationSettings[type].email|socket|sms|push (NotificationController). The
       same check the service does, written out here so a change there is noticed. */
    const out = notificationSettingsForSend(pageBody(), "voicemail", voicemailPayload());
    assert.equal(typeof out, "object");
    assert.ok(!Array.isArray(out));
    const settingsByType = out["voicemail"];
    assert.ok(settingsByType, "Notification settings not found for type: voicemail");
    assert.equal(Boolean(settingsByType.email), true);
    assert.equal(Boolean(settingsByType.socket), true);
    assert.equal(Boolean(settingsByType.sms), false);
    assert.equal(Boolean(settingsByType.push), true);
});

/* ---- Text alerts go to the number typed for that event --------------------------- */

test("smsRecipientFor: the event's own phone, else the account phone, else nothing", () => {
    assert.equal(smsRecipientFor(flat(), "missed", "+10000000000"), "+15551234567");
    assert.equal(smsRecipientFor(flat(), "voicemail", "+10000000000"), "+10000000000");
    assert.equal(smsRecipientFor(pageBody(), "missed", null), "+15551234567");
    assert.equal(smsRecipientFor(null, "voicemail", " +1 222 "), "+1 222");
    assert.equal(smsRecipientFor(null, "voicemail", null), "");
});
