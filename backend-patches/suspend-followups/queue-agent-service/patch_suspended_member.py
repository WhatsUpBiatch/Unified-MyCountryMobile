#!/usr/bin/env python3
"""Make the agent service refuse to ring a member carrying `suspended_member`.

    python3 patch_suspended_member.py /opt/queue-agent-service/queue_agent_service.py

Belt and braces: campaign-api already sets a suspended person's agent row to
"Logged Out", which this service never rings. The marker guard means that even
if something later flips their status (the old socket-login path, a hand edit),
a suspended or removed person is still never offered a call. Two hunks:

  * AGENT_FIELDS gains "suspended_member": 1 - it is a projection, so without
    this the marker is never read;
  * is_ringable() returns False when the marker is present.

Anchored on the running file (mcm-new, 2 Sep) and on the copy in
backend-patches/queue-agent-service; both later patches (escalation, talk /
last agent / rating) leave these two spots alone. Idempotent; a dated backup is
left beside the file.
"""
import io, shutil, sys, time

path = sys.argv[1] if len(sys.argv) > 1 else "queue_agent_service.py"
s = io.open(path, encoding="utf-8").read()

if 'row.get("suspended_member")' in s and '"suspended_member": 1' in s:
    print("already applied")
    sys.exit(0)

a1 = '    "talk_time": 1, "ready_time": 1,\n}\n'
r1 = '    "talk_time": 1, "ready_time": 1,\n    # Set by campaign-api when the person is suspended or removed; never ring them.\n    "suspended_member": 1,\n}\n'
a2 = ('def is_ringable(row, now, wrap_default=0):\n'
      '    if not str(row.get("contact") or "").strip():\n'
      '        return False\n')
r2 = ('def is_ringable(row, now, wrap_default=0):\n'
      '    if not str(row.get("contact") or "").strip():\n'
      '        return False\n'
      '    # A suspended or removed person keeps their seat (so a restore is exact)\n'
      '    # but is never offered a call, whatever their status says.\n'
      '    if row.get("suspended_member"):\n'
      '        return False\n')
for a in (a1, a2):
    if s.count(a) != 1:
        sys.exit(f"ANCHOR MISSING OR NOT UNIQUE: {a[:60]!r}")
stamp = time.strftime("%Y%m%d-%H%M%S")
shutil.copy2(path, f"{path}.bak-suspended-member-{stamp}")
s = s.replace(a1, r1, 1).replace(a2, r2, 1)
io.open(path, "w", encoding="utf-8").write(s)
print(f"applied; backup {path}.bak-suspended-member-{stamp}")
