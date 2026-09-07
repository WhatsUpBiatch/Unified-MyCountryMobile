/* The invite e-mail, as plain HTML.
 *
 * notification-api renders named templates from its own templates folder, and
 * that service is not part of this change (it would need its own deploy). So
 * the invite goes through the same mailer as every other notification with
 * `template: false` and this body. It carries the person's name, who invited
 * them, the company, the link and how long it lasts - and nothing else. No
 * password, no extension, no e-mail address.
 *
 * Pure: a test checks the body never contains a password field.
 */

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
