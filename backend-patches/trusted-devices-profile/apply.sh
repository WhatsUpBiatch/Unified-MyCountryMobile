#!/usr/bin/env bash
# Put the trusted-devices and self-profile endpoints on a running default-api.
#
#   bash apply.sh /var/www/prod/default-api
#
# Copies the eight compiled files, mounts the two routers in dist/app.js, runs
# the users.pronouns / users.interface_language migration, and restarts the
# service. Read README.md first: the migration needs ALTER on `users`, and
# the restart is whatever runs default-api on that box (pm2 assumed here;
# on api3 systemctl is a stub that does nothing - see the memory notes).
set -euo pipefail

TARGET="${1:?usage: apply.sh /path/to/default-api}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SERVICE="${SERVICE:-default-api}"

for f in controllers/TrustedDeviceController.js controllers/ProfileSelfController.js \
         routers/trustedDeviceRoute.js routers/profileSelfRoute.js \
         services/TrustedDeviceService.js services/trustedDeviceLogic.js \
         services/ProfileSelfService.js services/profileSelfLogic.js; do
  if [ -e "$TARGET/dist/$f" ]; then
    echo "refusing to overwrite existing $TARGET/dist/$f"; exit 1
  fi
done

for f in controllers/TrustedDeviceController.js controllers/ProfileSelfController.js \
         routers/trustedDeviceRoute.js routers/profileSelfRoute.js \
         services/TrustedDeviceService.js services/trustedDeviceLogic.js \
         services/ProfileSelfService.js services/profileSelfLogic.js; do
  install -D -m 0644 "$HERE/dist/$f" "$TARGET/dist/$f"
  echo "copied dist/$f"
done

# None of the eight may still carry a "@/" require: tsc-alias resolved them at
# build time, and a leftover one crashes the service on the next restart.
if grep -l 'require("@/' "$TARGET"/dist/controllers/TrustedDeviceController.js \
   "$TARGET"/dist/controllers/ProfileSelfController.js "$TARGET"/dist/routers/trustedDeviceRoute.js \
   "$TARGET"/dist/routers/profileSelfRoute.js "$TARGET"/dist/services/TrustedDeviceService.js \
   "$TARGET"/dist/services/trustedDeviceLogic.js "$TARGET"/dist/services/ProfileSelfService.js \
   "$TARGET"/dist/services/profileSelfLogic.js 2>/dev/null; then
  echo "unresolved @/ alias found above; not continuing"; exit 1
fi

python3 "$HERE/patch_app_routes.py" "$TARGET/dist/app.js"

install -D -m 0644 "$HERE/default-api/migrations/20260903151500-add-users-pronouns-interface-language.js" \
  "$TARGET/migrations/20260903151500-add-users-pronouns-interface-language.js"
(cd "$TARGET" && npx sequelize-cli db:migrate --env production) || {
  echo "migration failed; the endpoint's first-use guard will try the ALTER itself, but fix this"; }

if command -v pm2 >/dev/null 2>&1; then
  pm2 restart "$SERVICE"
else
  echo "restart $SERVICE by hand (no pm2 found)"
fi

echo
echo "Check (replace TOKEN):"
echo "  curl -s -X POST https://<api-host>/api/security/devices/list -H 'Authorization: Bearer TOKEN' -H 'Content-Type: application/json' -d '{}'"
echo "  curl -s -X POST https://<api-host>/api/profile/self -H 'Authorization: Bearer TOKEN' -H 'Content-Type: application/json' -d '{}'"
