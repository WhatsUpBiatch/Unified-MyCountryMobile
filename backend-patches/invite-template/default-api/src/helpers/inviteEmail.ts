/* The invite e-mail: the branded template's variables, and a plain-HTML
 * fallback body.
 *
 * First choice is the named notification-api template INVITE_LINK
 * (notification-api src/templates/ucaas/inviteLink.html), rendered by
 * notification-api with the variables from buildInviteTemplateData() plus the
 * logo / colours / footer it adds for every mail. If the notification-api on
 * the box does not have that template yet, it answers 200 with the e-mail
 * channel's result `false` (EmailService catches "Email template not found"
 * and returns false; it never throws) - inviteEmailWent() reads that answer,
 * and the sender falls back to `template: false` with buildInviteEmailHtml()
 * as the body, which every build sends as-is. The invite never fails to send
 * because a template is missing.
 *
 * Both carry the person's name, who invited them, the company, the link and
 * how long it lasts - and nothing else. No password, no extension, no e-mail
 * address. Pure: tests cover the variables, the escaping and the fallback
 * decision.
 */

/* The `body` notification-api turns into a template file name
   (INVITE_LINK -> inviteLink.html via CommonHelper.toCamelCase). */
export const INVITE_TEMPLATE_NAME = "INVITE_LINK";

/* Variables the INVITE_LINK template reads. Raw strings: notification-api
   renders with Handlebars, which HTML-escapes every {{variable}} itself.
   Nothing here is a password, an extension or an e-mail address. */
export interface InviteTemplateData {
    name: string;
    inviter_name: string;
    company_name: string;
    invite_link: string;
    ttl_days: number;
}

export interface InviteEmailInput {
    name: string;
    inviterName?: string | null;
    companyName?: string | null;
    projectName?: string | null;
    link: string;
    hours: number;
}

const escapeHtml = (value: unknown): string =>
    String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

const escapeAttr = (value: unknown): string => escapeHtml(value);

export const inviteEmailSubject = (companyName?: string | null, projectName?: string | null): string => {
    const where = String(companyName ?? "").trim() || String(projectName ?? "").trim();
    return where ? `You have been invited to join ${where}` : "You have been invited";
};

export const buildInviteEmailHtml = (input: InviteEmailInput): string => {
    const name = escapeHtml(String(input.name ?? "").trim() || "there");
    const inviter = String(input.inviterName ?? "").trim();
    const company = String(input.companyName ?? "").trim();
    const project = String(input.projectName ?? "").trim();
    const where = company || project;
    const days = Math.max(1, Math.round(Number(input.hours) / 24));
    const link = escapeAttr(input.link);

    const opening = inviter
        ? `${escapeHtml(inviter)} has added you to ${escapeHtml(where || "the team")}.`
        : `You have been added to ${escapeHtml(where || "the team")}.`;

    return [
        `<!DOCTYPE html>`,
        `<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />`,
        `<title>${escapeHtml(inviteEmailSubject(company, project))}</title></head>`,
        `<body style="margin:0;padding:0;background-color:#f3f6fa;font-family:Arial,Helvetica,sans-serif;">`,
        `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f3f6fa;">`,
        `<tr><td align="center" style="padding:28px 12px;">`,
        `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dbe4ee;border-radius:12px;">`,
        `<tr><td style="padding:28px 32px 8px 32px;font-size:18px;line-height:28px;font-weight:700;color:#111827;">Hello ${name},</td></tr>`,
        `<tr><td style="padding:0 32px 16px 32px;font-size:15px;line-height:24px;color:#374151;">${opening} To get started, choose your own password.</td></tr>`,
        `<tr><td align="center" style="padding:8px 32px 20px 32px;">`,
        `<a href="${link}" style="display:inline-block;padding:14px 22px;border-radius:8px;background:#1d6fe8;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">Choose my password</a>`,
        `</td></tr>`,
        `<tr><td style="padding:0 32px 8px 32px;font-size:14px;line-height:22px;color:#4b5563;">This link works for ${days} day${days === 1 ? "" : "s"}. After that, ask the person who added you to send a new one.</td></tr>`,
        `<tr><td style="padding:0 32px 8px 32px;font-size:13px;line-height:20px;color:#6b7280;">If the button does not work, copy this address into your browser:<br /><a href="${link}" style="color:#1d6fe8;word-break:break-all;">${link}</a></td></tr>`,
        `<tr><td style="padding:12px 32px 28px 32px;font-size:13px;line-height:20px;color:#6b7280;">If you were not expecting this, you can ignore this e-mail. Nothing changes until you choose a password.</td></tr>`,
        `</table></td></tr></table></body></html>`,
    ].join("");
};

export const buildInviteTemplateData = (input: InviteEmailInput): InviteTemplateData => ({
    name: String(input.name ?? "").trim() || "there",
    inviter_name: String(input.inviterName ?? "").trim(),
    company_name: String(input.companyName ?? "").trim() || String(input.projectName ?? "").trim(),
    invite_link: String(input.link ?? ""),
    ttl_days: Math.max(1, Math.round(Number(input.hours) / 24)),
});

/* Did the e-mail channel go? `result` is what SmsController.sendNotification
   returns: notification-api's `data.result`, an array of
   `{ channel: "email" | "socket" | "sms" | "push", result }`. For e-mail,
   `result` is `{ status, body }` on success (status 200 from SMTP, "202" as a
   string from SendGrid) and `false` on any failure - including a template
   file notification-api does not have. Anything else (no array, no e-mail
   entry, a non-2xx status) counts as "did not go". */
export const inviteEmailWent = (result: unknown): boolean => {
    if (!Array.isArray(result)) return false;
    const email = result.find((entry: any) => entry && entry.channel === "email");
    if (!email || !email.result || typeof email.result !== "object") return false;
    const status = Number((email.result as any).status);
    return Number.isFinite(status) && status >= 200 && status < 300;
};
