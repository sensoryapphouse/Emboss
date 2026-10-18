#!/bin/zsh
# Nightly random-action ("monkey") testing (A89; Paul, 2 Oct 2026: "set up the nightly run"). No AI, no credits: it starts a
# private dev server, runs Emboss/scripts/monkey-test.mjs in Chrome, WebKit and Firefox with a NEW random seed (so every night
# explores different documents and actions; the seed is printed, so any night can be replayed exactly), and leaves everything in
# ~/Library/Logs/Emboss-monkey/<date>/ — SUMMARY.txt first, run.log, and failures/<engine>-s<N>-<problem>/ with a replay file for
# each problem (node Emboss/scripts/monkey-test.mjs --port N --replay …/repro.json --repeat 3). A macOS notification says the result.
#
# Started at 02:00 by ~/Library/LaunchAgents/com.sensoryapphouse.emboss-nightly-monkey.plist (launchctl; if the Mac is asleep at
# 02:00 it runs when it next wakes). By hand:  zsh Emboss/scripts/nightly-monkey.sh   (MINUTES=10 for a shorter run).
# It tests whatever is checked out in the main checkout at the time. Documents placed in ~/Emboss-test-books/ (testers' real books,
# extreme documents) are added to the samples once the harness has --extra-docs.
set -u
REPO="/Users/paulblenkhorn/Documents/Development/PWAs/To do next/Braille"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
OUT="$HOME/Library/Logs/Emboss-monkey/$(date +%Y-%m-%d-%H%M)"
PORT="${PORT:-8297}"
MINUTES="${MINUTES:-30}"
mkdir -p "$OUT"
cd "$REPO" || { echo "no repo at $REPO" > "$OUT/SUMMARY.txt"; exit 1; }

node Emboss/scripts/serve.mjs "$PORT" > "$OUT/server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
for i in {1..30}; do curl -s -o /dev/null "http://localhost:$PORT/web/editor/index.html" && break; sleep 1; done

SUMMARY_OPT=()
grep -q -- "'--summary'" Emboss/scripts/monkey-test.mjs && SUMMARY_OPT=(--summary "$OUT/SUMMARY.txt")
EXTRA_OPT=()
grep -q -- "'--extra-docs'" Emboss/scripts/monkey-test.mjs && [[ -d "$HOME/Emboss-test-books" ]] && EXTRA_OPT=(--extra-docs "$HOME/Emboss-test-books")
node Emboss/scripts/monkey-test.mjs --port "$PORT" --engines chrome,webkit,firefox --minutes "$MINUTES" --shrink-minutes 6 \
  --out "$OUT/failures" "${SUMMARY_OPT[@]}" "${EXTRA_OPT[@]}" > "$OUT/run.log" 2>&1
STATUS=$?

# a summary even from a harness without --summary
if [[ ! -s "$OUT/SUMMARY.txt" ]]; then
  {
    echo "Emboss nightly random-action run — $(date)"
    echo "Commit: $(git -C "$REPO" log --oneline -1)"
    echo "Result: $([[ $STATUS -eq 0 ]] && echo 'no problems found' || echo 'PROBLEMS FOUND (exit '$STATUS')')"
    echo
    grep -iE "seed|problem\(s\)|^chrome:|^webkit:|^firefox:|^  [a-z-]+:|repro \(" "$OUT/run.log" | head -60
  } > "$OUT/SUMMARY.txt"
fi

if [[ $STATUS -eq 0 ]]; then MSG="No problems found."; else MSG="Problems found — see $OUT/SUMMARY.txt"; fi
osascript -e "display notification \"$MSG\" with title \"Emboss nightly test\"" >/dev/null 2>&1 || true
exit $STATUS
