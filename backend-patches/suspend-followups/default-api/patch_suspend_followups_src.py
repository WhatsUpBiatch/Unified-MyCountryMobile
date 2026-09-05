#!/usr/bin/env python3
"""Anchored, idempotent hunks in three existing default-api source files.

    python3 patch_suspend_followups_src.py [/root/UCAAS/mcm-repos/default-api]

  src/services/PersonStateService.ts  suspend(): kick the phone + mark queue seats;
                                      reactivate(): restore queue seats.
  src/services/DeletedUserService.ts  restore(): restore queue seats;
                                      purgeExpired(): remove them for good.
  src/models/User.ts                  afterBulkDestroy -> PersonRemovalHooks
                                      (the delete path, without touching UserController).

Every hunk asserts its anchor and refuses otherwise. Running it twice changes
nothing the second time. The three new services are copied whole, not patched.
"""
import io, os, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else "/root/UCAAS/mcm-repos/default-api"


def edit(rel, hunks):
    path = os.path.join(ROOT, rel)
    s = io.open(path, encoding="utf-8").read()
    changed = False
    for marker, anchor, replacement in hunks:
        if marker in s:
            print(f"  {rel}: already has {marker!r}")
            continue
        if anchor not in s:
            sys.exit(f"ANCHOR MISSING in {rel}: {anchor[:70]!r}")
        if s.count(anchor) != 1:
            sys.exit(f"ANCHOR NOT UNIQUE in {rel}: {anchor[:70]!r}")
        s = s.replace(anchor, replacement, 1)
        changed = True
        print(f"  {rel}: applied {marker!r}")
    if changed:
        io.open(path, "w", encoding="utf-8").write(s)


# ---- PersonStateService.ts ---------------------------------------------------
edit("src/services/PersonStateService.ts", [
    (
        "import RegistrationKickService",
        'import { RESTORE_WINDOW_HOURS } from "@/helpers/removalRouting";\n',
        'import { RESTORE_WINDOW_HOURS } from "@/helpers/removalRouting";\n'
        'import RegistrationKickService from "@/services/RegistrationKickService";\n'
        'import QueueMembershipService from "@/services/QueueMembershipService";\n',
    ),
    (
        "phone_flushed?: boolean",
        "    | { ok: true; state: PersonState; previous: PersonState; sessions_ended: number; message: string }\n",
        "    | {\n"
        "          ok: true;\n"
        "          state: PersonState;\n"
        "          previous: PersonState;\n"
        "          sessions_ended: number;\n"
        "          message: string;\n"
        "          /* Best-effort follow-ups (see RegistrationKickService, QueueMembershipService):\n"
        "             absent when nothing was attempted, false/0 when attempted and not confirmed. */\n"
        "          phone_flushed?: boolean;\n"
        "          queues_touched?: number;\n"
        "      }\n",
    ),
    (
        "followups = await this.afterSuspend",
        "        const sessions_ended = await this.endAllSessions(uuid);\n"
        "\n"
        "        console.log(\n"
        "            `PersonStateService: ${caller.uuid} suspended ${uuid} (company ${company_uuid}, was ${previous}, ${sessions_ended} session(s) ended)`,\n"
        "        );\n"
        "        return {\n"
        "            ok: true,\n"
        "            state: \"SUSPENDED\",\n"
        "            previous,\n"
        "            sessions_ended,\n"
        "            message: \"Person suspended. They are signed out everywhere and cannot sign in.\",\n"
        "        };\n",
        "        const sessions_ended = await this.endAllSessions(uuid);\n"
        "        const followups = await this.afterSuspend(caller, target, `(suspended by ${caller.uuid})`);\n"
        "\n"
        "        console.log(\n"
        "            `PersonStateService: ${caller.uuid} suspended ${uuid} (company ${company_uuid}, was ${previous}, ${sessions_ended} session(s) ended, phone ${followups.phone_flushed ? \"flushed\" : \"not flushed\"}, ${followups.queues_touched} queue(s) marked)`,\n"
        "        );\n"
        "        return {\n"
        "            ok: true,\n"
        "            state: \"SUSPENDED\",\n"
        "            previous,\n"
        "            sessions_ended,\n"
        "            message: \"Person suspended. They are signed out everywhere and cannot sign in.\",\n"
        "            ...followups,\n"
        "        };\n",
    ),
    (
        "restore their queue seats",
        "        await this.ensureStatusColumn();\n"
        "        await User.update({ status: \"ACTIVE\" } as any, { where: { uuid, company_uuid } });\n"
        "\n"
        "        console.log(`PersonStateService: ${caller.uuid} reactivated ${uuid} (company ${company_uuid}, was ${previous})`);\n"
        "        return {\n"
        "            ok: true,\n"
        "            state: \"ACTIVE\",\n"
        "            previous,\n"
        "            sessions_ended: 0,\n"
        "            message: \"Person reactivated. They can sign in again.\",\n"
        "        };\n",
        "        await this.ensureStatusColumn();\n"
        "        await User.update({ status: \"ACTIVE\" } as any, { where: { uuid, company_uuid } });\n"
        "\n"
        "        /* Best effort: restore their queue seats exactly as they were marked. */\n"
        "        const membership = await QueueMembershipService.setMembership(\n"
        "            caller, uuid, \"restore\", { extension: target.extension }, `(reactivated by ${caller.uuid})`,\n"
        "        );\n"
        "\n"
        "        console.log(`PersonStateService: ${caller.uuid} reactivated ${uuid} (company ${company_uuid}, was ${previous}, ${membership.queues_touched} queue(s) restored)`);\n"
        "        return {\n"
        "            ok: true,\n"
        "            state: \"ACTIVE\",\n"
        "            previous,\n"
        "            sessions_ended: 0,\n"
        "            message: \"Person reactivated. They can sign in again.\",\n"
        "            queues_touched: membership.queues_touched,\n"
        "        };\n",
    ),
    (
        "static async afterSuspend(",
        "    /** The \"all\" branch of AuthController.logOutUser, step for step. Returns how many sessions went. */\n",
        "    /**\n"
        "     * After the row says SUSPENDED and the sessions are gone: drop the phone's\n"
        "     * registration off the switch and take them out of every queue's agent\n"
        "     * list. Both best effort, both capped at 3 s, run side by side, never\n"
        "     * thrown. The person is suspended whatever these return.\n"
        "     */\n"
        "    static async afterSuspend(caller: IAuth, target: any, context: string): Promise<{ phone_flushed: boolean; queues_touched: number }> {\n"
        "        const [kick, membership] = await Promise.all([\n"
        "            RegistrationKickService.kickRegistration(target?.extension, caller.domain, context),\n"
        "            QueueMembershipService.setMembership(caller, String(target?.uuid ?? \"\"), \"suspend\", { extension: target?.extension, reason: \"suspended\" }, context),\n"
        "        ]);\n"
        "        return { phone_flushed: kick.ok, queues_touched: membership.queues_touched };\n"
        "    }\n"
        "\n"
        "    /** The \"all\" branch of AuthController.logOutUser, step for step. Returns how many sessions went. */\n",
    ),
])

# ---- DeletedUserService.ts ---------------------------------------------------
edit("src/services/DeletedUserService.ts", [
    (
        "import QueueMembershipService",
        '} from "@/helpers/removalRouting";\n',
        '} from "@/helpers/removalRouting";\n'
        'import QueueMembershipService from "@/services/QueueMembershipService";\n'
        'import { domainFromDbName } from "@/services/RegistrationKickService";\n',
    ),
    (
        "queue seats go for good",
        "        let purged = 0;\n"
        "        for (const row of rows) {\n"
        "            if (isTombstonedEmail(row.email)) continue;\n",
        "        let purged = 0;\n"
        "        /* Their queue seats go for good with the e-mail: a restore is no longer\n"
        "           possible, so the suspended_member markers left by the removal are\n"
        "           turned into removals. Best effort, one call per person. */\n"
        "        const company: any = rows.length\n"
        "            ? await Company.findOne({ where: { uuid: company_uuid }, attributes: [\"uuid\", \"db_name\"], raw: true })\n"
        "            : null;\n"
        "        for (const row of rows) {\n"
        "            if (isTombstonedEmail(row.email)) continue;\n"
        "            if (company?.db_name) {\n"
        "                await QueueMembershipService.setMembership(\n"
        "                    QueueMembershipService.systemActor(company_uuid, String(company.db_name), domainFromDbName(company.db_name)),\n"
        "                    String(row.uuid), \"remove\", { reason: \"purged\" }, \"(72-hour purge)\",\n"
        "                );\n"
        "            }\n",
    ),
    (
        "attributes: [\"uuid\", \"licenses\", \"db_name\"]",
        "        const company: any = await Company.findOne({ where: { uuid: company_uuid }, attributes: [\"uuid\", \"licenses\"], raw: true });\n",
        "        const company: any = await Company.findOne({ where: { uuid: company_uuid }, attributes: [\"uuid\", \"licenses\", \"db_name\"], raw: true });\n",
    ),
    (
        "queue seats come back with them",
        "            console.log(`DeletedUserService: restored user ${uuid} for company ${company_uuid} (licence ${licence})`);\n",
        "            /* Their queue seats come back with them, exactly as the removal marked\n"
        "               them (best effort; the log says how many). */\n"
        "            const membership = await QueueMembershipService.setMembership(\n"
        "                QueueMembershipService.systemActor(company_uuid, String(company?.db_name ?? \"\"), domainFromDbName(company?.db_name)),\n"
        "                uuid, \"restore\", { extension: restored?.extension }, \"(restored from Removed)\",\n"
        "            );\n"
        "            console.log(`DeletedUserService: restored user ${uuid} for company ${company_uuid} (licence ${licence}, ${membership.queues_touched} queue seat(s) restored)`);\n",
    ),
])

# ---- User.ts -----------------------------------------------------------------
edit("src/models/User.ts", [
    (
        "import PersonRemovalHooks",
        "import DidCountryPackageCostModel from './Admin/DidCountryModel';\n",
        "import DidCountryPackageCostModel from './Admin/DidCountryModel';\n"
        "import PersonRemovalHooks from '@/services/PersonRemovalHooks';\n",
    ),
    (
        "afterBulkDestroy",
        "        hooks: {\n"
        "            beforeSave: (user, options) => {\n"
        "                if (user.phone) {\n"
        "                    user.phone = CommonHelper.sanitizePhoneNumber(user.phone);\n"
        "                }\n"
        "            },\n"
        "        },\n",
        "        hooks: {\n"
        "            beforeSave: (user, options) => {\n"
        "                if (user.phone) {\n"
        "                    user.phone = CommonHelper.sanitizePhoneNumber(user.phone);\n"
        "                }\n"
        "            },\n"
        "            /* A removed person loses their phone registration and their queue\n"
        "               seats. Runs after the removal's transaction commits; best effort;\n"
        "               never throws into the delete. See services/PersonRemovalHooks.ts. */\n"
        "            afterBulkDestroy: (options) => {\n"
        "                PersonRemovalHooks.afterBulkDestroy(options);\n"
        "            },\n"
        "        },\n",
    ),
])
print("done")
