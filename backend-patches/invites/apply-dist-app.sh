#!/usr/bin/env bash
# Mount the invite router in a LIVE dist/app.js without replacing the file.
#
#   bash apply-dist-app.sh /var/www/prod/default-api/dist/app.js
#
# Production's app.js may carry hand-made fixes this mirror lacks (that has
# happened three times on this box), so this inserts exactly two lines next
# to the existing userRoute lines instead of copying a whole new app.js over
# it. Backs the file up beside itself first. Idempotent.
set -euo pipefail
APP="${1:?path to dist/app.js}"
[ -f "$APP" ] || { echo "no such file: $APP"; exit 1; }

if grep -q 'routers/inviteRoute' "$APP"; then
  echo "already mounted in $APP - nothing to do"; exit 0
fi
grep -q 'const userRoute_1 = __importDefault(require("./routers/userRoute"));' "$APP" \
  || { echo "anchor 1 (userRoute require) not found - look at the file by hand"; exit 1; }
grep -q 'app.use("/api/user", userRoute_1.default);' "$APP" \
  || { echo "anchor 2 (userRoute mount) not found - look at the file by hand"; exit 1; }
DIR="$(dirname "$APP")"
[ -f "$DIR/routers/inviteRoute.js" ] || { echo "copy dist/routers/inviteRoute.js (and the other five new files) first"; exit 1; }

cp "$APP" "$APP.bak-invites-$(date +%Y%m%d-%H%M%S)"
python3 - "$APP" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
a = 'const userRoute_1 = __importDefault(require("./routers/userRoute"));\n'
s = s.replace(a, a + 'const inviteRoute_1 = __importDefault(require("./routers/inviteRoute"));\n', 1)
b = '    app.use("/api/user", userRoute_1.default);\n'
s = s.replace(b, b + '    /* Invite links for new people (own controller: AuthController stays untouched). */\n    app.use("/api/invite", inviteRoute_1.default);\n', 1)
open(p, 'w').write(s)
PY
node --check "$APP" && echo "mounted; syntax ok. Now: pm2 restart default-api"
