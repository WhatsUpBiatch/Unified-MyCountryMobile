#!/usr/bin/env bash
# Undo apply.sh on a default-api install.
#
#   bash rollback.sh /var/www/prod/default-api
#
# Restores dist/app.js from the newest backup apply.sh made, removes the eight
# files, and restarts. The two columns are LEFT IN PLACE on purpose: dropping
# them throws away what people typed, nothing else reads them, and the
# migration's `down` exists for the day somebody decides otherwise
# (npx sequelize-cli db:migrate:undo --name 20260903151500-add-users-pronouns-interface-language.js).
set -euo pipefail

TARGET="${1:?usage: rollback.sh /path/to/default-api}"
SERVICE="${SERVICE:-default-api}"

BACKUP="$(ls -1t "$TARGET"/dist/app.js.bak-trusted-devices-* 2>/dev/null | head -1 || true)"
if [ -n "$BACKUP" ]; then
  cp "$BACKUP" "$TARGET/dist/app.js"
  echo "restored dist/app.js from $BACKUP"
else
  echo "no app.js backup found; remove the two require lines and two app.use lines by hand"
fi

for f in controllers/TrustedDeviceController.js controllers/ProfileSelfController.js \
         routers/trustedDeviceRoute.js routers/profileSelfRoute.js \
         services/TrustedDeviceService.js services/trustedDeviceLogic.js \
         services/ProfileSelfService.js services/profileSelfLogic.js; do
  rm -f "$TARGET/dist/$f" && echo "removed dist/$f"
done

if command -v pm2 >/dev/null 2>&1; then
  pm2 restart "$SERVICE"
else
  echo "restart $SERVICE by hand (no pm2 found)"
fi
