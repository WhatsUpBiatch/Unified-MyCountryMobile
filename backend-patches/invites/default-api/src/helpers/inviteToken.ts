/* Invite links: the token, its hash, the 72-hour window, and the password rule.
 *
 * Pure - no database, no request. Everything the invite endpoints decide on
 * lives here so it can be unit-tested without the API running.
 *
 * The person gets a 32-byte random token in a link. The database keeps only
 * its sha256, so a copy of the table cannot be turned into a working link.
 */

import { createHash, randomBytes, timingSafeEqual } from "crypto";

export const INVITE_TTL_HOURS = 72;
export const INVITE_MIN_PASSWORD_LENGTH = 12;
/* The password column is VARCHAR(150) with bcrypt; the create validator caps a
   password at 30 characters, so the throw-away one must fit under that. */
export const TEMP_PASSWORD_LENGTH = 24;
/* One resend per person per minute, so a stuck "Resend" button cannot flood a mailbox. */
export const RESEND_COOLDOWN_SECONDS = 60;

const TOKEN_BYTES = 32;
const TOKEN_HEX_RE = /^[0-9a-f]{64}$/;

export interface IssuedInviteToken {
    /* Goes into the link. Never stored. */
    token: string;
    /* Goes into the table. */
    tokenHash: string;
    expiresAt: Date;
}

export const hashInviteToken = (token: string): string =>
    createHash("sha256").update(String(token ?? ""), "utf8").digest("hex");

export const tokenLooksValid = (token: unknown): token is string =>
    typeof token === "string" && TOKEN_HEX_RE.test(token);

export const inviteExpiry = (now: Date = new Date()): Date =>
    new Date(now.getTime() + INVITE_TTL_HOURS * 60 * 60 * 1000);

export const issueInviteToken = (now: Date = new Date()): IssuedInviteToken => {
    const token = randomBytes(TOKEN_BYTES).toString("hex");
    return { token, tokenHash: hashInviteToken(token), expiresAt: inviteExpiry(now) };
};

export const isInviteExpired = (expiresAt: Date | string | null | undefined, now: Date = new Date()): boolean => {
    if (!expiresAt) return true;
    const at = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
    if (Number.isNaN(at.getTime())) return true;
    return at.getTime() <= now.getTime();
};

/* Constant-time compare of two hex hashes, so a wrong token costs the same
   time as a nearly-right one. */
export const hashesMatch = (a: string, b: string): boolean => {
    const ba = Buffer.from(String(a ?? ""), "utf8");
    const bb = Buffer.from(String(b ?? ""), "utf8");
    if (ba.length !== bb.length || ba.length === 0) return false;
    return timingSafeEqual(ba, bb);
};

export interface PasswordCheck {
    ok: boolean;
    message?: string;
}

/* The rule the accept page and the server both apply: 12 or more characters,
   not the person's own e-mail address (any case), no leading/trailing spaces
   that would be lost in a form. */
export const validateInvitePassword = (password: unknown, email: unknown): PasswordCheck => {
    if (typeof password !== "string" || password.length === 0) {
        return { ok: false, message: "Please choose a password." };
    }
    if (password !== password.trim()) {
        return { ok: false, message: "A password cannot start or end with a space." };
    }
    if (password.length < INVITE_MIN_PASSWORD_LENGTH) {
        return { ok: false, message: `Your password must be at least ${INVITE_MIN_PASSWORD_LENGTH} characters long.` };
    }
    const normalisedEmail = String(email ?? "").trim().toLowerCase();
    if (normalisedEmail && password.toLowerCase() === normalisedEmail) {
        return { ok: false, message: "Your password cannot be your e-mail address." };
    }
    return { ok: true };
};

/* A throw-away password for the new row. Nobody ever sees it: the person sets
   their own through the link. Built from crypto randomness, not Math.random,
   and it satisfies the create validator (6-30 chars) and the usual
   upper/lower/digit/symbol expectations so nothing downstream rejects it. */
export const randomTemporaryPassword = (length: number = TEMP_PASSWORD_LENGTH): string => {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const bytes = randomBytes(length);
    let out = "";
    for (let i = 0; i < length; i++) {
        out += alphabet[bytes[i] % alphabet.length];
    }
    /* Guarantee one of each class regardless of the draw. */
    return `A1!${out.slice(3)}`;
};

/* The link the e-mail carries. The base is whatever the platform already uses
   for its links (CommonHelper.getWebsiteUrl - the same one forgot-password
   uses); the page is the new public /accept-invite route. */
export const buildInviteLink = (websiteUrl: string, token: string): string => {
    const base = String(websiteUrl ?? "").trim().replace(/\/+$/, "");
    return `${base}/accept-invite?token=${encodeURIComponent(token)}`;
};

/* Seconds a caller has to wait before another resend for the same person. 0 = go ahead. */
export const resendWaitSeconds = (lastSentAt: Date | string | null | undefined, now: Date = new Date()): number => {
    if (!lastSentAt) return 0;
    const at = lastSentAt instanceof Date ? lastSentAt : new Date(lastSentAt);
    if (Number.isNaN(at.getTime())) return 0;
    const elapsed = Math.floor((now.getTime() - at.getTime()) / 1000);
    return elapsed >= RESEND_COOLDOWN_SECONDS ? 0 : RESEND_COOLDOWN_SECONDS - elapsed;
};
