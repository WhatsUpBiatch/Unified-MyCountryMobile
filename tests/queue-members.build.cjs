var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var queue_members_exports = {};
__export(queue_members_exports, {
  MANAGER_ROLES: () => MANAGER_ROLES,
  buildMember: () => buildMember,
  canManage: () => canManage,
  chooseManager: () => chooseManager,
  dedupeMembers: () => dedupeMembers,
  isOnQueue: () => isOnQueue,
  memberKey: () => memberKey,
  removesManager: () => removesManager,
  roleOf: () => roleOf,
  sortForQueue: () => sortForQueue,
  toggleMember: () => toggleMember
});
module.exports = __toCommonJS(queue_members_exports);
const memberKey = (member) => {
  const row = member ?? {};
  return String(row.value ?? row.extension ?? "").trim();
};
const isOnQueue = (list, person) => {
  const key = memberKey(person) || String(person?.extension ?? "").trim();
  if (!key) return false;
  return (Array.isArray(list) ? list : []).some((row) => memberKey(row) === key);
};
const buildMember = (person) => {
  const extension = String(person?.extension ?? person?.value ?? "").trim();
  if (!extension) return null;
  const full = person?.last_name ? `${person?.first_name} ${person?.last_name}` : person?.label || person?.first_name || "";
  return {
    label: full,
    name: full,
    value: extension,
    extension,
    email: person?.email,
    skills: person?.skills,
    role: person?.custom_role_data?.name || person?.role_data?.name || person?.role,
    /* Both spellings, because the people list is typed as carrying either and
       only one is populated at a time. Reading just one leaves every member
       with a blank id - which the save path then dedupes on, collapsing the
       whole queue to a single person. */
    user_uuid: person?.user_uuid || person?.uuid || ""
  };
};
const dedupeMembers = (list) => {
  const seen = /* @__PURE__ */ new Map();
  for (const row of Array.isArray(list) ? list : []) {
    const key = String(row?.user_uuid || "").trim() || memberKey(row);
    if (!key) continue;
    seen.set(key, row);
  }
  return [...seen.values()];
};
const toggleMember = (list, person, on) => {
  const current = Array.isArray(list) ? [...list] : [];
  const built = buildMember(person);
  if (!built) return current;
  const already = isOnQueue(current, built);
  const turningOn = on === void 0 ? !already : on;
  if (turningOn) {
    if (already) return current;
    return [...current, built];
  }
  return current.filter((row) => memberKey(row) !== memberKey(built));
};
const removesManager = (person, manager) => {
  const extension = String(person?.extension ?? "").trim();
  if (!extension) return false;
  return String(manager?.value ?? "").trim() === extension;
};
const MANAGER_ROLES = ["MANAGER", "ADMIN", "SUB-ADMIN", "SUPER-ADMIN"];
const roleOf = (person) => person?.custom_role_data?.name || person?.role_data?.name || person?.role || "";
const canManage = (person) => MANAGER_ROLES.includes(String(roleOf(person)).toUpperCase());
const chooseManager = (list, currentManager) => {
  const members = Array.isArray(list) ? list : [];
  const chosen = memberKey(currentManager);
  if (chosen) {
    const still = members.find((row) => memberKey(row) === chosen);
    if (still && canManage(still)) return still;
  }
  return members.find((row) => canManage(row)) || null;
};
const sortForQueue = (people, list, currentManager) => {
  const rows = Array.isArray(people) ? [...people] : [];
  const managerKey = memberKey(currentManager);
  const rank = (person) => {
    const key = String(person?.extension ?? person?.value ?? "").trim();
    if (key && key === managerKey) return 0;
    return isOnQueue(list, person) ? 1 : 2;
  };
  return rows.map((person, index) => ({ person, index, rank: rank(person) })).sort((a, b) => a.rank - b.rank || a.index - b.index).map((entry) => entry.person);
};
