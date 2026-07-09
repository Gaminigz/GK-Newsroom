#!/bin/bash
# GK Newsroom desktop auto-agent — runs on the Mac via launchd every 30 min.
# Pulls the repo; if DESKTOP-TASKS.md contains a PENDING task, runs Claude
# Code headless to execute the queue. Cloud sessions add tasks by pushing
# to that file; no human copy-paste involved.
#
# One-time install (from the repo root on the Mac):
#   bash src/scripts/desktop-agent.sh --install
#
# Logs: ~/Library/Logs/gk-newsroom-agent.log

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
BRANCH="claude/git-review-ja0lpn"
LOG="$HOME/Library/Logs/gk-newsroom-agent.log"
PLIST="$HOME/Library/LaunchAgents/com.gk.newsroom.agent.plist"

if [[ "${1:-}" == "--install" ]]; then
  mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
  cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.gk.newsroom.agent</string>
  <key>ProgramArguments</key><array>
    <string>/bin/bash</string>
    <string>$REPO_DIR/src/scripts/desktop-agent.sh</string>
  </array>
  <key>StartInterval</key><integer>1800</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
</dict></plist>
PL
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  echo "installed — runs every 30 min; log: $LOG"
  exit 0
fi

cd "$REPO_DIR"
echo "=== $(date) agent tick ==="

git fetch origin "$BRANCH" --quiet
git checkout "$BRANCH" --quiet 2>/dev/null || true
git pull --ff-only origin "$BRANCH" --quiet

if ! grep -q "— PENDING" DESKTOP-TASKS.md; then
  echo "no pending tasks"
  exit 0
fi

echo "pending tasks found — invoking claude"
claude --dangerously-skip-permissions -p "You are the GK Newsroom desktop
agent on the user's Mac, in the yai-newsroom repo. Open DESKTOP-TASKS.md
and execute every task still marked PENDING, top to bottom, following the
rules at the top of that file. Use the local .env for credentials and the
logged-in Railway CLI. When done, make sure DESKTOP-TASKS.md statuses are
updated, committed, and pushed to $BRANCH."
echo "=== agent tick complete ==="
