#!/usr/bin/env bash
#
# Require a login on the media route that currently asks nobody who they are.
#
# NOT APPLIED. Every attempt to write under /var/www/prod/default-api from the
# session that wrote this was refused by a permission rule. Access is not the
# problem - all three boxes answer ssh fine. Run this yourself, or allow that
# path in settings and ask the session to run it.
#
# THE HOLE. default-api mounts six media routes. Five carry AuthMiddleware.
# This one does not:
#
#   dist/routers/mediaRoute.js:17
#   mediaRoute.get("/direct/:uuid/:type/:file_name", catchErrors(getDirectMediaFile));
#
# Proved 1 Sep 2026 from the open internet, no credentials:
#   GET /api/media/direct/default/recording/<file>.mp3   -> 200, 12068 bytes of MP3
#   control, authenticated sibling route                 -> 401
#   control, made-up name on the open route              -> 404 from storage
# The 404 is the one that matters: the request reached the bucket, so a real
# file name really would have been served.
#
# ON ALL THREE BOXES, confirmed by reading each running dist:
#   mcm-new     142.93.121.121   api2   line 17 unguarded
#   mcm-ucaas3  151.106.57.254   api3   line 17 unguarded
#   mcm-switch  167.99.4.91      api4   line 17 unguarded
# Public probes: api, api2 and api3 hostnames all served the file. api4 has no
# DNS from here, but its box carries the same line.
#
# WHY IT CANNOT SIMPLY BE CLOSED. Two callers need an outsider to fetch a file
# and neither has a token: `fax` (URL handed to the fax carrier) and
# `video_recording` (meeting links opened by people with no account). They are
# the only two consumers in the frontend or any of the 20 backend repos, so an
# allow-list of those two closes everything else and breaks nothing.
#
# The source is already patched (mcm-repos/default-api/src/routers/
# mediaRoute.ts) and `npx tsc --noEmit` over that project is clean, so a future
# build ships this. This script is only for the running dist, which is ahead of
# source - see F8 in docs/admin-audit-tracker.md.
#
set -euo pipefail
HOSTS="${*:-mcm-new mcm-ucaas3 mcm-switch}"
F=/var/www/prod/default-api/dist/routers/mediaRoute.js
PATCHER="$(cd "$(dirname "$0")" && pwd)/patch_direct_media_auth.py"

for H in $HOSTS; do
    echo "=== $H ==="
    ssh "$H" "cat > /tmp/patch_direct_media_auth.py" < "$PATCHER"
    ssh "$H" "set -e
        cp $F $F.bak-directguard-\$(date +%Y%m%d-%H%M%S)
        python3 /tmp/patch_direct_media_auth.py $F
        node --check $F && echo '    syntax ok'
        pm2 restart default-api >/dev/null && sleep 3
        pm2 describe default-api | grep -i 'status' | head -1"
done

cat <<'CHECKS'

=== verify from anywhere, no credentials ===

  # every one of these must now read 401
  for h in api api2 api3; do printf '%-5s ' $h; curl -s -o /dev/null -w '%{http_code}\n' \
    --max-time 20 https://$h.mycountrymobile.com/api/media/direct/default/recording/ad98d65d-fcf8-4d4d-bc77-ee1426c34333.mp3; done

  # CONTROL - fax must still reach storage. 404 is the pass, 401 means fax is broken
  curl -s -o /dev/null -w '%{http_code}\n' \
    https://api2.mycountrymobile.com/api/media/direct/00000000-0000-0000-0000-000000000000/fax/nope.pdf

  # CONTROL - the authenticated sibling is unchanged
  curl -s -o /dev/null -w '%{http_code}\n' \
    https://api2.mycountrymobile.com/api/media/00000000-0000-0000-0000-000000000000/recording/nope.wav

401 / 404 / 401 is the pass. A 401 on the fax control means fax sending has been
broken and this must be rolled back at once.

=== revert one box ===

  ssh HOST "cp \$(ls -1t $F.bak-directguard-* | head -1) $F && pm2 restart default-api"
CHECKS
