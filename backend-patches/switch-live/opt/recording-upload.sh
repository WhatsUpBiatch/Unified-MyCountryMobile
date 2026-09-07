#!/usr/bin/env bash
# recording-upload.sh — HOST-SIDE recording uploader for api2.
#
# WHY: the FreeSWITCH container is a stripped busybox image with no curl and no
# package manager, so the in-container hangup-hook uploader (upload_recording.lua)
# fails on every call ("/usr/bin/curl: not found") and .wav files strand in
# /opt/call-recordings/tmp/. The host HAS curl 8.5.0, so we run the identical
# 3-step presigned upload here instead. Mirrors the working cdr-ingest pattern.
#
#   bash recording-upload.sh              # DRY RUN: list what would upload, do nothing
#   bash recording-upload.sh --apply      # actually upload (and delete on success)
#   bash recording-upload.sh --apply --one <call_uuid>   # process a single file (safe first test)
#
# Idempotent: a successfully uploaded+linked file is deleted; failures are kept.
# Reads all endpoints/keys from the SAME config.lua the Lua hook uses, so no
# secret is hardcoded here and it can never drift from the real config.
set -uo pipefail

CFG="/etc/freeswitch/scripts/config.lua"
TMPDIR="/opt/call-recordings/tmp"
CDRDIR="/opt/call-recordings/cdr"          # processed/ holds company_uuid per call
MIN_AGE_SECONDS=30                          # skip recordings still being written
MIN_SIZE=4096                               # same silence threshold as the Lua hook
APPLY=0; ONE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1; shift;;
    --one) ONE="$2"; shift 2;;
    *) echo "unknown arg: $1"; exit 2;;
  esac
done

command -v curl >/dev/null || { echo "FAIL: host curl not found"; exit 3; }
[ -f "$CFG" ] || { echo "FAIL: $CFG not found"; exit 3; }

# Pull config values from config.lua (var = "value")
luaval() { grep -oP "^\\s*$1\\s*=\\s*\"\\K[^\"]+" "$CFG" 2>/dev/null | head -1; }
# Addresses come from config.lua, but can be overridden via env — needed because
# the config's public fs_internal_api_addr (api.mycountrymobile.com/api/internal)
# has no /api/internal route, while default-api serves it directly on :3000.
#   MEDIA_ADDR=http://127.0.0.1:3000/api/media \
#   INTERNAL_ADDR=http://127.0.0.1:3000/api/internal bash recording-upload.sh ...
# Default to default-api on localhost:3000 — PROVEN to serve both routes. The
# config.lua public addresses are NOT used by default because its
# fs_internal_api_addr (api.mycountrymobile.com/api/internal) has no such route
# (nginx has no /api/internal location) → the historical 404. Override via env.
MEDIA_ADDR="${MEDIA_ADDR:-http://127.0.0.1:3000/api/media}"
INTERNAL_ADDR="${INTERNAL_ADDR:-http://127.0.0.1:3000/api/internal}"
KEY=$(luaval fs_internal_key)
[ -n "$MEDIA_ADDR" ] && [ -n "$INTERNAL_ADDR" ] && [ -n "$KEY" ] || {
  echo "FAIL: could not read fs_media_api_addr / fs_internal_api_addr / fs_internal_key from $CFG"; exit 3; }

echo "media api : $MEDIA_ADDR"
echo "internal  : $INTERNAL_ADDR"
echo "mode      : $([ "$APPLY" = 1 ] && echo APPLY || echo 'DRY RUN')"
echo

# Find the company_uuid for a call from its CDR (a_<uuid>.cdr.xml under cdr/**)
company_for() {
  local uuid="$1" f
  for f in "$CDRDIR"/processed/a_"$uuid".cdr.xml "$CDRDIR"/a_"$uuid".cdr.xml \
           "$CDRDIR"/processed/*"$uuid"*.cdr.xml; do
    [ -f "$f" ] || continue
    grep -oE 'company_uuid=[0-9a-f-]{36}' "$f" 2>/dev/null | head -1 | cut -d= -f2 && return 0
  done
  return 1
}

upload_one() {  # $1 = full path to wav
  local path="$1" uuid company ask result url fname code attach
  uuid="$(basename "$path" .wav)"

  local size; size=$(stat -c %s "$path" 2>/dev/null || echo 0)
  if [ "$size" -lt "$MIN_SIZE" ]; then
    echo "  [$uuid] only ${size}B (silence/truncated) — would discard"
    [ "$APPLY" = 1 ] && rm -f "$path"
    return 0
  fi

  company="$(company_for "$uuid")"
  if [ -z "$company" ]; then
    echo "  [$uuid] SKIP — no company_uuid found in CDRs (kept for retry)"
    return 1
  fi

  if [ "$APPLY" != 1 ]; then
    echo "  [$uuid] would upload (${size}B, company=$company)"
    return 0
  fi

  # 1) ask for a presigned URL
  ask=$(curl -s --max-time 30 -X POST "$MEDIA_ADDR/direct/upload/url" \
        -H 'Content-Type: application/json' \
        -H "Authorization: Bearer $KEY" \
        -d "{\"uuid\":\"$company\",\"type\":\"recording\",\"file_name\":\"$uuid.wav\"}")
  # result lives at data.data.result or data.result
  url=$(printf '%s' "$ask" | grep -oP '"url"\s*:\s*"\K[^"]+' | head -1)
  fname=$(printf '%s' "$ask" | grep -oP '"file_name"\s*:\s*"\K[^"]+' | head -1)
  if [ -z "$url" ] || [ -z "$fname" ]; then
    echo "  [$uuid] ERR — no upload url in response (kept). resp: $(printf '%s' "$ask" | head -c 160)"
    return 1
  fi

  # 2) PUT the file (-f: non-2xx is an error, not a written error page)
  code=$(curl -s -f --max-time 300 -X PUT "$url" \
         -H 'Content-Type: audio/wav' -T "$path" -o /dev/null -w '%{http_code}')
  if ! printf '%s' "$code" | grep -qE '^2[0-9][0-9]$'; then
    echo "  [$uuid] ERR — storage refused (http $code) — file KEPT at $path"
    return 1
  fi

  # 3) link it to the call
  attach=$(curl -s --max-time 30 -X POST "$INTERNAL_ADDR/call-recording" \
           -H 'Content-Type: application/json' \
           -H "Authorization: Bearer $KEY" \
           -d "{\"call_uuid\":\"$uuid\",\"company_uuid\":\"$company\",\"file_name\":\"$fname\"}")
  if printf '%s' "$attach" | grep -q '"success":true'; then
    rm -f "$path"
    echo "  [$uuid] OK — stored and linked"
    return 0
  else
    # DO NOT delete on link failure in a backfill. Unlike the live hook, here a
    # 404/again-and-again link failure would orphan the file in storage AND lose
    # the local copy. Keep it so it can be re-linked once the endpoint is fixed.
    echo "  [$uuid] KEPT — uploaded to storage but link failed (file NOT deleted): $(printf '%s' "$attach" | head -c 120)"
    return 1
  fi
}

# Build the work list
if [ -n "$ONE" ]; then
  FILES=("$TMPDIR/$ONE.wav")
else
  mapfile -t FILES < <(find "$TMPDIR" -maxdepth 1 -name '*.wav' -type f \
                        -mmin +$(awk "BEGIN{print $MIN_AGE_SECONDS/60}") 2>/dev/null | sort)
fi
[ "${#FILES[@]}" -eq 0 ] && { echo "no eligible .wav files in $TMPDIR"; exit 0; }

echo "eligible files: ${#FILES[@]}"
ok=0; fail=0
for f in "${FILES[@]}"; do
  [ -f "$f" ] || { echo "  (missing: $f)"; continue; }
  if upload_one "$f"; then ok=$((ok+1)); else fail=$((fail+1)); fi
done
echo
echo "done. ok=$ok  kept/failed=$fail"
[ "$APPLY" != 1 ] && echo "DRY RUN — nothing uploaded. Re-run with --apply (test one first: --apply --one <uuid>)."
