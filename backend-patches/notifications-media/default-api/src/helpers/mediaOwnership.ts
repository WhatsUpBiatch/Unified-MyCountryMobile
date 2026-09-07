/* Who may delete a recording in the company's audio library.
 *
 * The library is the `ivrfiles` table in the company's own database: one row per
 * recording, `user_uuid` = the person who uploaded it, `type` = greeting / prompt /
 * voicemail, `is_default` = a stock recording the product ships. The audio itself is
 * an object in the media bucket at `<company uuid>/<folder>/<filename>`.
 *
 * Deleting is two calls from the website: the row (`DELETE /api/tenant/greeting/delete`)
 * and then the file (`DELETE /api/media/delete`). Until 3 Sep 2026 neither call asked
 * who was calling: any signed-in person with the plan's "delete" permission could
 * remove any recording in the company, including the ones a queue or an IVR plays,
 * and the file route did not even check that the company in the path was the caller's.
 *
 * THE RULE, IN ONE LINE
 *
 *   The file must belong to the caller's company, AND the caller is an admin OR the
 *   caller is the person who uploaded it. Stock recordings are never deleted.
 *
 * Both calls apply this rule against the same row, so the answer is the same
 * whichever call is made first. Nothing here touches a database or the network.
 *
 * IDENTICAL COPIES
 *
 * The same file is kept in tenant-api and default-api (both under src/helpers/). It has
 * no imports on purpose so it can be copied byte for byte; a test checks the copies match.
 */

/* The folders of the audio library. Every other media type (profile, recording, fax,
   ...) is somebody else's and is not governed by the row rule. */
export const LIBRARY_TYPES: readonly string[] = ["greeting", "prompt", "voicemail"];

/* What a recording is filed as when the client does not say, or says something that
   is not a library type. */
export const DEFAULT_LIBRARY_TYPE = "greeting";

/* The role string that means "runs the company". Matches CompanyPolicyLock and the
   rest of default-api: `users.role` compared as an upper-cased word. */
export const isAdminRole = (role: unknown): boolean =>
    String(role ?? "").trim().toUpperCase() === "ADMIN";

export const isLibraryType = (type: unknown): boolean =>
    LIBRARY_TYPES.indexOf(String(type ?? "").trim().toLowerCase()) !== -1;

/* The type to store for an upload: the client's choice when it is a library type,
   else the default. Case and whitespace are forgiven. */
export const normaliseLibraryType = (type: unknown): string => {
    const word = String(type ?? "").trim().toLowerCase();
    return isLibraryType(word) ? word : DEFAULT_LIBRARY_TYPE;
};

export interface LibraryCaller {
    uuid: string | null | undefined;
    role: string | null | undefined;
}

/* The parts of an `ivrfiles` row the rule looks at. */
export interface LibraryRow {
    user_uuid?: string | null;
    is_default?: boolean | number | string | null;
}

export interface DeleteDecision {
    allowed: boolean;
    /* Plain English for the person, when refused. */
    reason: string;
}

const asFlag = (value: unknown): boolean =>
    value === true || value === 1 || value === "1" || String(value ?? "").trim().toLowerCase() === "true";

const sameUuid = (a: unknown, b: unknown): boolean => {
    const left = String(a ?? "").trim().toLowerCase();
    const right = String(b ?? "").trim().toLowerCase();
    return left !== "" && left === right;
};

/**
 * May `caller` delete the recording described by `row`?
 *
 * `row` null means the library has no record of the file. That happens for an
 * orphan (the row went, the file stayed) and for a file name that was never in the
 * library. Only an admin may clear those up: with no row there is nobody to be "the
 * uploader".
 */
export const libraryDeleteDecision = (caller: LibraryCaller, row: LibraryRow | null | undefined): DeleteDecision => {
    if (!caller || !String(caller.uuid ?? "").trim()) {
        return { allowed: false, reason: "Sign in to delete recordings." };
    }
    if (row && asFlag(row.is_default)) {
        return { allowed: false, reason: "Stock recordings cannot be deleted." };
    }
    if (isAdminRole(caller.role)) {
        return { allowed: true, reason: "" };
    }
    if (!row) {
        return {
            allowed: false,
            reason: "This file is not in the library. Ask an admin to remove it.",
        };
    }
    if (sameUuid(row.user_uuid, caller.uuid)) {
        return { allowed: true, reason: "" };
    }
    return {
        allowed: false,
        reason: "Only the person who uploaded this recording, or an admin, can delete it.",
    };
};

/**
 * May `caller` delete a file at `<pathUuid>/<type>/<name>` at all, before the row is
 * even looked at? The company in the path must be the caller's own. A person's own
 * uuid is accepted too: some older paths file a person's recordings under the
 * person, not the company.
 */
export const fileBelongsToCaller = (
    caller: { uuid: string | null | undefined; company_uuid: string | null | undefined },
    pathUuid: unknown,
): boolean => sameUuid(pathUuid, caller?.company_uuid) || sameUuid(pathUuid, caller?.uuid);
