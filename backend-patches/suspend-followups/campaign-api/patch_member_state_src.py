#!/usr/bin/env python3
"""Anchored, idempotent hunks in four campaign-api source files, adding

    POST /api/v1/campaign/queue/member/state
    { user_uuid, extension?, action: suspend|restore|remove, reason? }

    python3 patch_member_state_src.py [/root/UCAAS/mcm-repos/campaign-api]

  src/repositories/QueueRepository.ts  setMemberState(); upsert() carries an
                                       existing suspended_member marker over a
                                       re-save and starts a marked agent row
                                       "Logged Out"
  src/controllers/QueueController.ts   memberState()
  src/schemas/queue.ts                 memberStateValidation; userSchema tolerates
                                       suspended_member on a member sent back
  src/routes/api.ts                    the route (Auth + RequireAdmin)

src/services/queueMembership.ts (the pure part) is copied whole. Anchors were
taken from branch feat/outbound-dialer (c16f4e9); the same lines exist on
feat/queue-settings-and-tiers (2b74561), the branch production is built from.
Every hunk asserts its anchor and refuses otherwise; a second run is a no-op.
"""
import io, os, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else "/root/UCAAS/mcm-repos/campaign-api"


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


# ---- QueueRepository.ts ------------------------------------------------------
edit("src/repositories/QueueRepository.ts", [
    (
        'from "@/services/queueMembership"',
        'import { NatsController } from "@/nats/NatsController";\n',
        'import { NatsController } from "@/nats/NatsController";\n'
        'import { IMemberState } from "@/interfaces/IQueueRequest";\n'
        'import { MEMBERSHIP_ACTIONS, agentName, agentStatusForMember, agentUpdateFor, applyToMembers, carryMarkers, tierUpdateFor } from "@/services/queueMembership";\n',
    ),
    (
        "members = carryMarkers(",
        "            // Only add _id to the filter if we are performing an UPDATE\n",
        "            // Only add _id to the filter if we are performing an UPDATE\n"
        "\n"
        "            /* A person suspended (or removed, within their restore window) keeps\n"
        "               their seat with a suspended_member marker. The website sends the\n"
        "               roster back without it, so carry it over; otherwise a routine\n"
        "               re-save of the queue would put them back on the ring. */\n"
        "            if (requestData?.uuid) {\n"
        "                const existing: any = await QueueModel.findOne({ _id: requestData.uuid, company_uuid: companyId }).select(\"members\").lean();\n"
        "                members = carryMarkers(existing?.members, members);\n"
        "            }\n",
    ),
    (
        "...agentStatusForMember(member)",
        "                    contact: `user/${member?.extension}_web@${domain}`, // Standardized format\n"
        "                    status: 'On Break',\n"
        "                    state: 'Idle'\n"
        "                }));\n",
        "                    contact: `user/${member?.extension}_web@${domain}`, // Standardized format\n"
        "                    /* On Break / Idle, or Logged Out for a member carrying a\n"
        "                       suspended_member marker: the agent service must not ring them. */\n"
        "                    ...agentStatusForMember(member),\n"
        "                    ...(member?.suspended_member ? { suspended_member: member.suspended_member } : {})\n"
        "                }));\n",
    ),
    (
        "public static async setMemberState(",
        "    public static async queueAgentStatus(request: { user_uuid?: unknown; webOnline?: unknown; }): Promise<object> {\n",
        "    /**\n"
        "     * A person's seat in every queue of the company: mark it suspended, restore\n"
        "     * it exactly, or remove it. Called by default-api when a person is\n"
        "     * suspended / reactivated / removed / restored / purged. See\n"
        "     * services/queueMembership.ts for what each action does to the queue\n"
        "     * record, the agent row and the tier row. Queues are read one by one and\n"
        "     * each one is finished before the next, so a failure part-way leaves\n"
        "     * whole queues either done or untouched.\n"
        "     */\n"
        "    public static async setMemberState(request: IMemberState, userData: IUser): Promise<object> {\n"
        "        const { QueueModel, QueueAgentModel, QueueTierModel } = await this.getMainQueueModels();\n"
        "        const user_uuid = String(request?.user_uuid ?? \"\").trim();\n"
        "        const action = String(request?.action ?? \"\").trim() as any;\n"
        "        const reason = String(request?.reason ?? action);\n"
        "        if (!user_uuid) throw new HttpException(422, \"user_uuid is required\");\n"
        "        if (!MEMBERSHIP_ACTIONS.includes(action)) throw new HttpException(422, `action must be one of ${MEMBERSHIP_ACTIONS.join(\", \")}`);\n"
        "        const companyId = String(userData?.company_uuid ?? \"\");\n"
        "        if (!companyId) throw new HttpException(401, \"company is required\");\n"
        "        const now = new Date();\n"
        "\n"
        "        const queues: any[] = await QueueModel.find({\n"
        "            company_uuid: companyId,\n"
        "            $or: [{ \"members.user_uuid\": user_uuid }, { \"members.value\": user_uuid }],\n"
        "        }).select(\"_id extension domain members\").lean();\n"
        "\n"
        "        const summary = { action, user_uuid, queues_touched: 0, members_changed: 0, agents_changed: 0, tiers_changed: 0, queues: [] as string[] };\n"
        "        for (const queue of queues) {\n"
        "            const result = applyToMembers(queue.members, user_uuid, action, now, reason);\n"
        "            if (result.changed) {\n"
        "                await QueueModel.updateOne({ _id: queue._id, company_uuid: companyId }, { $set: { members: result.members } });\n"
        "                summary.members_changed += result.changed;\n"
        "            }\n"
        "\n"
        "            const domain = queue.domain || userData?.domain;\n"
        "            const extensions = Array.from(new Set(\n"
        "                result.matched.map((m: any) => String(m?.extension ?? \"\").trim()).concat(String(request?.extension ?? \"\").trim()).filter(Boolean),\n"
        "            ));\n"
        "            const agentFilter: Record<string, any> = { queue_uuid: queue._id, \"user_detail.user_uuid\": user_uuid };\n"
        "            const tierFilter: Record<string, any> = {\n"
        "                queue: agentName(queue.extension, domain),\n"
        "                agent: { $in: extensions.map((ext) => agentName(ext, domain)) },\n"
        "            };\n"
        "\n"
        "            const agentUpdate = agentUpdateFor(action, now, reason);\n"
        "            const agents = agentUpdate\n"
        "                ? await QueueAgentModel.updateMany(agentFilter, agentUpdate)\n"
        "                : await QueueAgentModel.deleteMany(agentFilter);\n"
        "            summary.agents_changed += Number(agents?.modifiedCount ?? agents?.deletedCount ?? 0);\n"
        "\n"
        "            if (extensions.length) {\n"
        "                const tierUpdate = tierUpdateFor(action, now, reason);\n"
        "                const tiers = tierUpdate\n"
        "                    ? await QueueTierModel.updateMany(tierFilter, tierUpdate)\n"
        "                    : await QueueTierModel.deleteMany(tierFilter);\n"
        "                summary.tiers_changed += Number(tiers?.modifiedCount ?? tiers?.deletedCount ?? 0);\n"
        "            }\n"
        "\n"
        "            summary.queues_touched++;\n"
        "            summary.queues.push(String(queue._id));\n"
        "        }\n"
        "\n"
        "        console.log(`QueueRepository.setMemberState ${action} ${user_uuid} (${reason}) company=${companyId}: ${summary.queues_touched} queue(s), ${summary.members_changed} member(s), ${summary.agents_changed} agent row(s), ${summary.tiers_changed} tier row(s)`);\n"
        "        return summary;\n"
        "    }\n"
        "\n"
        "    public static async queueAgentStatus(request: { user_uuid?: unknown; webOnline?: unknown; }): Promise<object> {\n",
    ),
])

# ---- IQueueRequest.ts --------------------------------------------------------
edit("src/interfaces/IQueueRequest.ts", [
    (
        "export interface IMemberState",
        "export interface IQueueAgentStatus {\n",
        "/** POST queue/member/state - a person's seat in every queue of the company. */\n"
        "export interface IMemberState {\n"
        "    user_uuid: string;\n"
        "    extension?: string;\n"
        "    action: \"suspend\" | \"restore\" | \"remove\";\n"
        "    reason?: string;\n"
        "}\n"
        "\n"
        "export interface IQueueAgentStatus {\n",
    ),
])

# ---- QueueController.ts ------------------------------------------------------
edit("src/controllers/QueueController.ts", [
    (
        "public memberState = async",
        "    public queueAgentStatus = async (request: Request, response: Response): Promise<Response | void | Object> => {\n",
        "    /** default-api calls this when a person is suspended, reactivated, removed, restored or purged. */\n"
        "    public memberState = async (request: Request, response: Response): Promise<Response> => {\n"
        "        try {\n"
        "            const result = await QueueRepository.setMemberState(request?.body, request?.user);\n"
        "            return response.status(200).send(new ResponseModel({ success: true, data: result }));\n"
        "        } catch (error: any) {\n"
        "            if (super.isNull(error.status)) {\n"
        "                return super.handleError(ApiErrors.ServerError, error, response);\n"
        "            } else {\n"
        "                return super.handleError(error, error, response);\n"
        "            }\n"
        "        }\n"
        "    };\n"
        "\n"
        "    public queueAgentStatus = async (request: Request, response: Response): Promise<Response | void | Object> => {\n",
    ),
])

# ---- schemas/queue.ts --------------------------------------------------------
edit("src/schemas/queue.ts", [
    (
        "suspended_member: Joi.any()",
        "    tier: Joi.number().integer().min(1).max(3).optional(),\n"
        "    rating: Joi.number().min(0).max(100).optional()\n"
        "});\n",
        "    tier: Joi.number().integer().min(1).max(3).optional(),\n"
        "    rating: Joi.number().min(0).max(100).optional(),\n"
        "    /* Set by queue/member/state when the person is suspended or removed; a\n"
        "       website that sends the roster back unchanged must not be refused. */\n"
        "    suspended_member: Joi.any().optional()\n"
        "});\n"
        "\n"
        "export const memberStateValidation = Joi.object().options({ abortEarly: false }).keys({\n"
        "    user_uuid: Joi.string().trim().min(1).required(),\n"
        "    extension: Joi.string().trim().allow(\"\", null).optional(),\n"
        "    action: Joi.string().valid(\"suspend\", \"restore\", \"remove\").required(),\n"
        "    reason: Joi.string().trim().max(64).allow(\"\", null).optional()\n"
        "});\n",
    ),
])

# ---- routes/api.ts -----------------------------------------------------------
edit("src/routes/api.ts", [
    (
        "memberStateValidation",
        'import { agentStatusValidation, createQueueValidation, publicQueueInfoValidation, queueUuIdValidation } from "@/schemas/queue";\n',
        'import { agentStatusValidation, createQueueValidation, memberStateValidation, publicQueueInfoValidation, queueUuIdValidation } from "@/schemas/queue";\n',
    ),
    (
        "queue/member/state",
        "        this.router.post(`${this.path}queue/agent/status`, Validator(agentStatusValidation, \"body\"), Auth, this.queue.setAgentQueueStatus);\n",
        "        this.router.post(`${this.path}queue/agent/status`, Validator(agentStatusValidation, \"body\"), Auth, this.queue.setAgentQueueStatus);\n"
        "        /* A person's seat in every queue: suspend / restore / remove. Called by default-api. */\n"
        "        this.router.post(`${this.path}queue/member/state`, Validator(memberStateValidation, \"body\"), Auth, RequireAdmin, this.queue.memberState);\n",
    ),
])
print("done")
