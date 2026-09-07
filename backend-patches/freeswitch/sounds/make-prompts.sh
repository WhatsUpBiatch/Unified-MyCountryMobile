#!/usr/bin/env bash
# Re-renders the queue position prompts. Deterministic: same espeak-ng, same
# text, same output. Needs espeak-ng and ffmpeg. Output: ./deploy/
set -euo pipefail
cd "$(dirname "$0")"; mkdir -p raw deploy/digits
say(){ espeak-ng -v en-us -s 145 -p 45 -a 170 -w "raw/$1.wav" "$2"; ffmpeg -loglevel error -y -i "raw/$1.wav" -ar 8000 -ac 1 -acodec pcm_s16le "deploy/$1.wav"; }
say position-intro "You are caller number"
say position-outro "in the queue. Please stay on the line and we will be with you shortly."
say position-next "You are next in line. Please stay on the line."
say position-many "There are many callers ahead of you. Please stay on the line and we will be with you as soon as we can."
for n in $(seq 1 100); do espeak-ng -v en-us -s 145 -p 45 -a 170 -w "raw/$n.wav" "$n"; ffmpeg -loglevel error -y -i "raw/$n.wav" -ar 8000 -ac 1 -acodec pcm_s16le "deploy/digits/$n.wav"; done
echo "rendered $(ls deploy/digits | wc -l) numbers + $(ls deploy/*.wav | wc -l) phrases into deploy/"
