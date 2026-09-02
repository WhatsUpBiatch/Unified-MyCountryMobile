/* Putting people on a queue. The screen could only ever hold one, so the
   headline test is the plain one: tick three people, get three people. */

const assert = require('assert');
const {
  memberKey,
  isOnQueue,
  buildMember,
  toggleMember,
  removesManager,
} = require('./queue-members.build.cjs');

let passed = 0;
const check = (what, fn) => {
  fn();
  passed += 1;
  console.log('  ok  ' + what);
};

const person = (ext, first, last) => ({
  extension: ext,
  first_name: first,
  last_name: last,
  email: `${first}@example.com`.toLowerCase(),
  uuid: 'u-' + ext,
  role: 'AGENT',
});

const RAHUL = person('9456', 'Rahul', 'Jatt');
const USER2 = person('3689', 'User2', 'Agent2');
const AUGUST = person('1794', 'August', '001');
const UMAR = person('1000', 'Umar', 'Ansari');

check('THE BUG: ticking three people keeps all three', () => {
  let list = [];
  list = toggleMember(list, RAHUL);
  list = toggleMember(list, USER2);
  list = toggleMember(list, AUGUST);
  assert.strictEqual(list.length, 3, JSON.stringify(list.map((m) => m.value)));
  assert.deepStrictEqual(
    list.map((m) => m.value),
    ['9456', '3689', '1794'],
  );
});

check('CONTROL the stale-list bug reproduced, so the fix is not imaginary', () => {
  /* What the screen did: each tick built from the list as it was when that row
     last rendered, which for every row was the empty list. */
  const stale = [];
  const afterFirst = toggleMember(stale, RAHUL);
  const afterSecond = toggleMember(stale, USER2); // still the empty list
  assert.strictEqual(afterFirst.length, 1);
  assert.strictEqual(afterSecond.length, 1, 'the second tick discards the first');
  assert.strictEqual(afterSecond[0].value, '3689', 'and only the last one survives');
});

check('unticking removes only that person', () => {
  let list = toggleMember(toggleMember(toggleMember([], RAHUL), USER2), AUGUST);
  list = toggleMember(list, USER2, false);
  assert.deepStrictEqual(
    list.map((m) => m.value),
    ['9456', '1794'],
  );
});

check('ticking somebody already on the queue changes nothing', () => {
  const once = toggleMember([], RAHUL);
  const twice = toggleMember(once, RAHUL, true);
  assert.strictEqual(twice.length, 1);
});

check('unticking somebody who is not on it changes nothing', () => {
  const list = toggleMember([], RAHUL);
  assert.deepStrictEqual(toggleMember(list, UMAR, false), list);
});

check('the whole roster can go on, and come off again', () => {
  let list = [];
  for (const p of [RAHUL, USER2, AUGUST, UMAR]) list = toggleMember(list, p);
  assert.strictEqual(list.length, 4);
  for (const p of [RAHUL, USER2, AUGUST, UMAR]) list = toggleMember(list, p, false);
  assert.strictEqual(list.length, 0);
});

check('a person is stored under their extension, which is what the screen matches on', () => {
  const built = buildMember(RAHUL);
  assert.strictEqual(built.value, '9456');
  assert.strictEqual(built.extension, '9456');
  assert.strictEqual(built.name, 'Rahul Jatt');
  assert.strictEqual(built.user_uuid, 'u-9456');
});

check('somebody with no extension is refused rather than stored as blank', () => {
  assert.strictEqual(buildMember({ first_name: 'Nobody' }), null);
  assert.deepStrictEqual(toggleMember([], { first_name: 'Nobody' }), []);
});

check('CONTROL two people with no extension cannot collapse into one row', () => {
  let list = toggleMember([], { first_name: 'A' });
  list = toggleMember(list, { first_name: 'B' });
  assert.strictEqual(list.length, 0, 'neither is stored, rather than both matching each other');
});

check('a person with only a value still works, as older saved rows have', () => {
  const built = buildMember({ value: '5555', label: 'Old Row' });
  assert.strictEqual(built.value, '5555');
  assert.ok(isOnQueue([built], { extension: '5555' }));
});

check('membership is read off the same key everywhere', () => {
  assert.strictEqual(memberKey({ value: '1000' }), '1000');
  assert.strictEqual(memberKey({ extension: '1000' }), '1000');
  assert.strictEqual(memberKey({}), '');
  assert.strictEqual(isOnQueue(null, RAHUL), false);
});

check('taking off the manager is reported, so their badge can be cleared', () => {
  assert.strictEqual(removesManager(RAHUL, { value: '9456' }), true);
  assert.strictEqual(removesManager(RAHUL, { value: '3689' }), false);
  assert.strictEqual(removesManager(RAHUL, null), false);
});

check('the list handed in is never mutated', () => {
  const original = toggleMember([], RAHUL);
  const copy = [...original];
  toggleMember(original, USER2);
  assert.deepStrictEqual(original, copy);
});

console.log('\n  ' + passed + ' checks passed');

// --- the manager, and the order people are listed in -----------------------
const {
  canManage,
  chooseManager,
  sortForQueue,
} = require('./queue-members.build.cjs');

const withRole = (p, role) => ({ ...p, role });
const AGENT_A = withRole(RAHUL, 'AGENT');
const MANAGER_B = withRole(USER2, 'MANAGER');
const AGENT_C = withRole(AUGUST, 'AGENT');
const ADMIN_D = withRole(UMAR, 'ADMIN');

check('only manager-ish roles may run a queue', () => {
  assert.strictEqual(canManage(MANAGER_B), true);
  assert.strictEqual(canManage(ADMIN_D), true);
  assert.strictEqual(canManage(AGENT_A), false);
  assert.strictEqual(canManage({ role_data: { name: 'Sub-Admin' } }), true);
  assert.strictEqual(canManage({}), false);
});

check('the first eligible person to join is put in charge automatically', () => {
  let list = toggleMember([], AGENT_A);
  assert.strictEqual(chooseManager(list, null), null, 'an agent cannot run it');
  list = toggleMember(list, MANAGER_B);
  assert.strictEqual(chooseManager(list, null).value, '3689');
});

check('THE ONE THAT MATTERS: a manager chosen on purpose is never overruled', () => {
  const list = [MANAGER_B, ADMIN_D].reduce((acc, p) => toggleMember(acc, p), []);
  /* ADMIN_D is second in the list, so an automatic pick would choose MANAGER_B.
     Having been chosen deliberately, ADMIN_D must stay. */
  assert.strictEqual(chooseManager(list, { value: '1000' }).value, '1000');
});

check('taking the manager off the queue promotes the next eligible person', () => {
  let list = [MANAGER_B, ADMIN_D].reduce((acc, p) => toggleMember(acc, p), []);
  list = toggleMember(list, MANAGER_B, false);
  assert.strictEqual(chooseManager(list, { value: '3689' }).value, '1000');
});

check('CONTROL a queue of agents only has nobody to put in charge', () => {
  const list = [AGENT_A, AGENT_C].reduce((acc, p) => toggleMember(acc, p), []);
  assert.strictEqual(chooseManager(list, null), null);
  assert.strictEqual(chooseManager(list, { value: '9456' }), null, 'and an agent is not kept');
});

check('an empty queue has no manager', () => {
  assert.strictEqual(chooseManager([], null), null);
  assert.strictEqual(chooseManager(null, { value: '3689' }), null);
});

check('the manager is listed first, then the people on the queue, then the rest', () => {
  const people = [AGENT_A, MANAGER_B, AGENT_C, ADMIN_D];
  const list = [AGENT_C, MANAGER_B].reduce((acc, p) => toggleMember(acc, p), []);
  const order = sortForQueue(people, list, { value: '3689' }).map((p) => p.extension);
  /* 3689 runs it, 1794 is on it, then the two who are not - in the order they
     were listed in to begin with. */
  assert.deepStrictEqual(order, ['3689', '1794', '9456', '1000']);
});

check('people at the same rank keep the order they arrived in', () => {
  const people = [AGENT_A, AGENT_C, ADMIN_D];
  const order = sortForQueue(people, [], null).map((p) => p.extension);
  assert.deepStrictEqual(order, ['9456', '1794', '1000'], 'nothing reshuffles when nobody is on');
});

check('sorting never loses or duplicates anybody', () => {
  const people = [AGENT_A, MANAGER_B, AGENT_C, ADMIN_D];
  const list = toggleMember([], ADMIN_D);
  const sorted = sortForQueue(people, list, { value: '1000' });
  assert.strictEqual(sorted.length, people.length);
  assert.strictEqual(new Set(sorted.map((p) => p.extension)).size, people.length);
});

console.log('\n  ' + passed + ' checks passed in total');

// --- saving: the dedupe that could collapse the whole queue ------------------
const { dedupeMembers } = require('./queue-members.build.cjs');

check('THE TRAP: members with no id are kept apart, not collapsed into one', () => {
  const noIds = [
    { value: '9456', name: 'Rahul', user_uuid: '' },
    { value: '3689', name: 'User2', user_uuid: '' },
    { value: '1794', name: 'August', user_uuid: '' },
  ];
  assert.strictEqual(dedupeMembers(noIds).length, 3);
});

check('CONTROL deduping on the id alone loses two of the three', () => {
  const noIds = [
    { value: '9456', user_uuid: '' },
    { value: '3689', user_uuid: '' },
    { value: '1794', user_uuid: '' },
  ];
  const naive = Array.from(new Map(noIds.map((m) => [m.user_uuid, m])).values());
  assert.strictEqual(naive.length, 1, 'which is the bug this exists to prevent');
});

check('a genuine duplicate is still removed', () => {
  const rows = [
    { value: '9456', user_uuid: 'u-1' },
    { value: '9456', user_uuid: 'u-1' },
    { value: '3689', user_uuid: 'u-2' },
  ];
  assert.strictEqual(dedupeMembers(rows).length, 2);
});

check('the id is read under either spelling', () => {
  assert.strictEqual(buildMember({ extension: '1', user_uuid: 'a' }).user_uuid, 'a');
  assert.strictEqual(buildMember({ extension: '1', uuid: 'b' }).user_uuid, 'b');
  assert.strictEqual(buildMember({ extension: '1' }).user_uuid, '');
});

console.log('\n  ' + passed + ' checks passed in total');
