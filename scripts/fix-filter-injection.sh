#!/usr/bin/env bash
#
# Closes the filter-injection hole in default-api.
#
# The pattern, repeated across the service:
#
#     let where = { company_uuid };              // tenant scope set FIRST
#     filter.forEach(({ key, value }) => {
#         where[key] = { [Op.like]: `%${value}%` };   // caller chooses the key
#     });
#
# `key` comes straight from the request body, so a caller sending
# key="company_uuid" overwrites the tenant scope and reads every customer's rows.
#
# This inserts a guard at the top of each vulnerable loop refusing the columns
# that carry scope. A denylist, not an allow-list: an allow-list is the better
# shape, but it needs to know each endpoint's real filterable columns, and that
# judgement does not belong in a mechanical patch against compiled output. This
# blocks the actual exploit and is safe to apply without knowing each caller.
#
# Safe to run twice: an already-guarded site is skipped.
#
# Run:  bash fix-filter-injection.sh            (report only, changes nothing)
#       bash fix-filter-injection.sh --apply    (patch, syntax-check, report)
#
# It does NOT restart anything. Restart yourself, then confirm the process start
# time is later than the file mtime.

set -uo pipefail
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1
DIST=/var/www/prod/default-api/dist
STAMP=$(date +%Y%m%d-%H%M%S)

# file : line-of-the-where[key]-assignment : the loop-opening line to guard after
SITES="
controllers/DID/DidController.js|where[key] = { [sequelize_1.Op.like]: \`\${value}%\` };|filter.forEach((_value) => {
controllers/BillingController.js|where[key] = { [sequelize_1.Op.like]: \`%\${value}%\` };|filter.forEach(({ key, value }) => {
controllers/Roles/index.js|where[key] = { [sequelize_1.Op.like]: \`\${value}%\` };|filter.forEach(_value => {
"

GUARD='if (["company_uuid","user_uuid","website_uuid","tenant_uuid","uuid","id"].includes(String(key))) { return; }'

echo "default-api filter-injection sweep   ($([ $APPLY = 1 ] && echo APPLYING || echo 'report only'))"
echo "dist: $DIST"
echo

cd "$DIST" || { echo "cannot reach $DIST"; exit 1; }

changed=0
for f in controllers/DID/DidController.js controllers/BillingController.js controllers/Roles/index.js controllers/CRMController.js controllers/UserController.js; do
  [ -f "$f" ] || { printf '  %-42s MISSING\n' "$f"; continue; }
  hits=$(grep -cE '(where|whereCond)\[key\] =' "$f" 2>/dev/null); hits=${hits:-0}
  guarded=$(grep -c 'includes(String(key))' "$f" 2>/dev/null); guarded=${guarded:-0}
  printf '  %-42s %s assignment(s), %s already guarded\n' "$f" "$hits" "$guarded"
done
echo

if [ $APPLY = 0 ]; then
  echo "Nothing changed. Re-run with --apply to patch."
  exit 0
fi

for f in controllers/DID/DidController.js controllers/BillingController.js controllers/Roles/index.js controllers/CRMController.js controllers/UserController.js; do
  [ -f "$f" ] || continue
  if grep -q 'includes(String(key))' "$f"; then
    printf '  %-42s already guarded, skipped\n' "$f"
    continue
  fi
  cp -p "$f" "$f.bak-$STAMP"

  # Insert the guard immediately before every `where[key] =` / `whereCond[key] =`
  # assignment, matching that line's own indentation.
  perl -i -pe '
    if (/^(\s*)((?:where|whereCond|queryOptions\.where)\[key\]\s*=)/) {
      my $ind = $1;
      $_ = $ind . q{if (["company_uuid","user_uuid","website_uuid","tenant_uuid","uuid","id"].includes(String(key))) { return; }} . "\n" . $_;
    }
  ' "$f"

  if node --check "$f" 2>/dev/null; then
    n=$(grep -c 'includes(String(key))' "$f")
    printf '  %-42s patched (%s guard(s)), syntax OK\n' "$f" "$n"
    changed=$((changed+1))
  else
    mv "$f.bak-$STAMP" "$f"
    printf '  %-42s SYNTAX ERROR — rolled back, untouched\n' "$f"
  fi
done

echo
echo "$changed file(s) changed. Backups: *.bak-$STAMP"
echo
echo "Next, on THIS server:"
echo "    pm2 restart default-api"
echo "    # then confirm the patch is actually running:"
echo "    stat -c 'file:    %y' $DIST/controllers/BillingController.js"
echo "    ps -o lstart= -p \$(pm2 pid default-api)"
echo "The process start time must be LATER than the file time."
