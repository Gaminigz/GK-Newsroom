#!/bin/bash
# GK Newsroom desktop auto-agent — the Mac end of the cloud↔Mac bus.
#
# Installed as a macOS LaunchAgent, so it starts BY ITSELF every time the
# Mac boots and the user logs in (RunAtLoad), then re-checks every 30
# minutes (StartInterval). Each tick: pull the repo, and if
# DESKTOP-TASKS.md has a PENDING task, run Claude Code headless to work
# the queue, then push the updated statuses back. Cloud/mobile sessions
# queue work simply by pushing to that file — no copy-paste, no clicking.
#
#   bash src/scripts/desktop-agent.sh --install     one-time setup
#   bash src/scripts/desktop-agent.sh --status      is it loaded? last log
#   bash src/scripts/desktop-agent.sh --run-now     force a tick immediately
#   bash src/scripts/desktop-agent.sh --uninstall   stop and remove
#
# Logs: ~/Library/Logs/gk-newsroom-agent.log

set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BRANCH="claude/git-review-ja0lpn"
LABEL="com.gk.newsroom.agent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/gk-newsroom-agent.log"
LOCK="/tmp/gk-newsroom-agent.lock"
INTERVAL=1800          # 30 min between ticks
MAX_LOG_BYTES=5242880  # trim the log past 5 MB

# Claude Code may live in a few places; launchd's PATH is minimal, so
# resolve it explicitly rather than trusting the environment.
find_claude() {
  local c
  c="$(command -v claude 2>/dev/null)" && [[ -x "$c" ]] && { echo "$c"; return 0; }
  for c in "$HOME/.claude/local/claude" /opt/homebrew/bin/claude /usr/local/bin/claude; do
    [[ -x "$c" ]] && { echo "$c"; return 0; }
  done
  return 1
}

case "${1:-}" in
  --install)
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    CLAUDE_BIN="$(find_claude)" || { echo "claude CLI not found — install Claude Code first"; exit 1; }
    cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>/bin/bash</string>
    <string>$REPO_DIR/src/scripts/desktop-agent.sh</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>$INTERVAL</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>WorkingDirectory</key><string>$REPO_DIR</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$(dirname "$CLAUDE_BIN"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
</dict></plist>
PL
    launchctl unload "$PLIST" 2>/dev/null
    launchctl load "$PLIST" || { echo "launchctl load failed"; exit 1; }
    echo "installed: starts automatically at every login/boot, re-checks every $((INTERVAL/60)) min"
    echo "claude:    $CLAUDE_BIN"
    echo "log:       $LOG"
    exit 0
    ;;
  --uninstall)
    launchctl unload "$PLIST" 2>/dev/null
    rm -f "$PLIST"
    echo "removed — the agent will no longer start at login"
    exit 0
    ;;
  --status)
    if launchctl list | grep -q "$LABEL"; then
      echo "LOADED — auto-starts at login"
    else
      echo "NOT loaded — run: bash $0 --install"
    fi
    [[ -f "$LOG" ]] && { echo "--- last 20 log lines ---"; tail -20 "$LOG"; }
    exit 0
    ;;
  --run-now)
    launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>/dev/null && { echo "tick triggered — watch: tail -f $LOG"; exit 0; }
    echo "not loaded; running inline instead"
    ;;
esac

# ---------------------------------------------------------------- tick

# Never let two ticks overlap (a long generation run can exceed 30 min).
exec 9>"$LOCK"
if ! flock -n 9 2>/dev/null; then
  # macOS has no flock(1) by default; fall back to a PID file check.
  if [[ -f "$LOCK.pid" ]] && kill -0 "$(cat "$LOCK.pid" 2>/dev/null)" 2>/dev/null; then
    echo "$(date) — previous tick still running, skipping"
    exit 0
  fi
fi
echo $$ > "$LOCK.pid"
trap 'rm -f "$LOCK.pid"' EXIT

# Keep the log from growing forever.
if [[ -f "$LOG" ]] && [[ "$(wc -c < "$LOG")" -gt "$MAX_LOG_BYTES" ]]; then
  tail -2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

echo "=== $(date) tick ==="
cd "$REPO_DIR" || { echo "repo not found: $REPO_DIR"; exit 1; }

# Right after boot the network may not be up yet — wait up to 2 minutes.
for _ in $(seq 1 24); do
  git ls-remote --exit-code origin >/dev/null 2>&1 && break
  sleep 5
done

git fetch origin "$BRANCH" --quiet || { echo "fetch failed — offline?"; exit 0; }
git checkout "$BRANCH" --quiet 2>/dev/null
git pull --ff-only origin "$BRANCH" --quiet || echo "pull not fast-forward — continuing with local state"

if ! grep -q "— PENDING" DESKTOP-TASKS.md 2>/dev/null; then
  echo "no pending tasks"
  exit 0
fi

CLAUDE_BIN="$(find_claude)" || { echo "claude CLI not found on PATH"; exit 1; }
echo "pending tasks found — invoking $CLAUDE_BIN"

"$CLAUDE_BIN" --dangerously-skip-permissions -p "You are the GK Newsroom desktop
agent running unattended on the user's Mac, in the yai-newsroom repo. Open
DESKTOP-TASKS.md and execute every task still marked PENDING, top to bottom,
following the rules at the top of that file. Use the local .env for credentials
and the logged-in Railway CLI. Never ask questions — pick the sensible option
and continue. When finished, update each task's status line in DESKTOP-TASKS.md
with the result, then commit and push to $BRANCH."

echo "=== $(date) tick complete ==="
