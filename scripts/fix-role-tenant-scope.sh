#!/usr/bin/env bash
#
# Closes the cross-customer role hole in default-api.
#
# Four operations in controllers/Roles/index.js act on a role by uuid alone:
#
#     yield Role_1.default.destroy({ where: { uuid } });
#
# The route behind that one is:
#
#     roleRoute.delete("/delete/:uuid", AuthMiddleware, catchErrors(remove));
#
# reachable at DELETE /api/user/role/delete/:uuid. AuthMiddleware establishes
# who you are, never what you may do. So any authenticated user, at any
# customer, can delete or rewrite any role on the platform if they know its
# uuid. Both Role and CustomRole carry a company_uuid column, and roles are
# created with it, so scoping is the correct fix and not a workaround.
#
# WHAT THIS DOES: adds company_uuid to all four where clauses, so an operation
# can only touch roles belonging to the caller's own company.
#
# WHAT THIS DOES NOT DO: gate the routes on an administrator role. Managing
# roles should almost certainly be admin-only, but which of your roles may do
# it is a product decision, and guessing it here would lock people out of a
# working screen. This closes the cross-customer damage — the severe half — and
# leaves the in-company question to you. Issue 1 in the audit is the real
# answer to it.
#
# Safe to run twice: an already-scoped file is skipped.
#
# Run:  bash fix-role-tenant-scope.sh            (report only, changes nothing)
#       bash fix-role-tenant-scope.sh --apply    (patch, syntax-check, report)
#
# It does NOT restart anything.

set -uo pipefail
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1
DIST=/var/www/prod/default-api/dist
F="$DIST/controllers/Roles/index.js"
STAMP=$(date +%Y%m%d-%H%M%S)

echo "default-api role tenant-scope fix   ($([ $APPLY = 1 ] && echo APPLYING || echo 'report only'))"
echo "file: $F"
echo

[ -f "$F" ] || { echo "  file not found — is this a default-api server?"; exit 1; }

# The four anchors, verbatim. If any is missing the file is not the shape this
# script was written against, and it refuses rather than guessing.
A1='                model = yield Role_1.default.update({ name, description, permission }, { where: { uuid }, returning: true });'
A2='            yield Role_1.default.destroy({ where: { uuid } });'
A3='                result = yield CustomRole_1.default.update(requestObj, { where: { uuid } });'
A4='            yield CustomRole_1.default.destroy({ where: { uuid } });'

found=0
for i in 1 2 3 4; do
  eval "a=\$A$i"
  if grep -qF "$a" "$F"; then
    printf '  anchor %s  found\n' "$i"; found=$((found+1))
  else
    printf '  anchor %s  NOT FOUND\n' "$i"
  fi
done
echo

already=$(grep -cF 'where: { uuid, company_uuid }' "$F" 2>/dev/null); already=${already:-0}
if [ "$already" -gt 0 ]; then
  echo "  $already site(s) already scoped — this file looks patched. Nothing to do."
  exit 0
fi

if [ "$found" -ne 4 ]; then
  echo "  Only $found of 4 anchors matched. Refusing to edit."
  echo "  Check the file by hand rather than forcing this."
  exit 1
fi

if [ $APPLY = 0 ]; then
  echo "  All 4 anchors matched. Nothing changed."
  echo "  Re-run with --apply to patch."
  exit 0
fi

cp -p "$F" "$F.bak-$STAMP"

python3 - "$F" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()

# 1 and 3: company_uuid is already destructured in these two handlers,
#          so only the where clause needs it.
s = s.replace(
 '                model = yield Role_1.default.update({ name, description, permission }, { where: { uuid }, returning: true });',
 '                model = yield Role_1.default.update({ name, description, permission }, { where: { uuid, company_uuid }, returning: true });')
s = s.replace(
 '                result = yield CustomRole_1.default.update(requestObj, { where: { uuid } });',
 '                result = yield CustomRole_1.default.update(requestObj, { where: { uuid, company_uuid } });')

# 2 and 4: these two handlers destructure only req.params, so the caller's
#          company has to be read first.
s = s.replace(
 '            yield Role_1.default.destroy({ where: { uuid } });',
 '            const { company_uuid } = req.auth;\n'
 '            yield Role_1.default.destroy({ where: { uuid, company_uuid } });')
s = s.replace(
 '            yield CustomRole_1.default.destroy({ where: { uuid } });',
 '            const { company_uuid } = req.auth;\n'
 '            yield CustomRole_1.default.destroy({ where: { uuid, company_uuid } });')

open(p, 'w').write(s)
PY

n=$(grep -cF 'where: { uuid, company_uuid }' "$F")
if node --check "$F" 2>/dev/null && [ "$n" -eq 4 ]; then
  echo "  patched — 4 sites scoped, syntax OK"
  echo "  backup: $F.bak-$STAMP"
else
  mv "$F.bak-$STAMP" "$F"
  echo "  FAILED (syntax error, or $n of 4 sites changed) — rolled back, file untouched"
  exit 1
fi

echo
echo "Next, on THIS server:"
echo "    pm2 restart default-api"
echo "    stat -c 'file:    %y' $F"
echo "    ps -o lstart= -p \$(pm2 pid default-api)"
echo "The process start time must be LATER than the file time."
