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
RC_LABEL="com.gk.newsroom.remotecontrol"
RC_PLIST="$HOME/Library/LaunchAgents/$RC_LABEL.plist"
RC_LOG="$HOME/Library/Logs/gk-newsroom-remotecontrol.log"
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

# Remote Control autostart. Two documented pieces:
#   1. remoteControlAtStartup:true in ~/.claude/settings.json — every
#      interactive session connects without anyone clicking a toggle.
#   2. `claude remote-control` server mode, kept alive by launchd, so the
#      Mac is reachable from phone/cloud sessions even with no window open.
# Caveat: Anthropic documents the setting and the command, but not this
# launchd pairing — KeepAlive restarts it if it exits, and the session URL
# lands in $RC_LOG.
install_remote_control() {
  local claude_bin="$1"
  local settings="$HOME/.claude/settings.json"
  mkdir -p "$HOME/.claude" "$HOME/Library/Logs"

  if command -v node >/dev/null 2>&1; then
    node -e '
      const fs = require("fs"), p = process.argv[1];
      let j = {};
      try { j = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
      j.remoteControlAtStartup = true;
      fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
      console.log("settings.json: remoteControlAtStartup = true");
    ' "$settings" || echo "could not update $settings — set remoteControlAtStartup:true by hand"
  else
    echo "node not found — set \"remoteControlAtStartup\": true in $settings by hand"
  fi

  cat > "$RC_PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$RC_LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$claude_bin</string>
    <string>remote-control</string>
    <string>--name</string>
    <string>GK Mac</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$RC_LOG</string>
  <key>StandardErrorPath</key><string>$RC_LOG</string>
  <key>WorkingDirectory</key><string>$REPO_DIR</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$(dirname "$claude_bin"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
</dict></plist>
PL
  launchctl unload "$RC_PLIST" 2>/dev/null
  launchctl load "$RC_PLIST" && echo "remote control: on at every boot (log: $RC_LOG)"
}

case "${1:-}" in
  --install-remote)
    CLAUDE_BIN="$(find_claude)" || { echo "claude CLI not found — install Claude Code first"; exit 1; }
    install_remote_control "$CLAUDE_BIN"
    exit 0
    ;;
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
    echo "task agent:  on at every boot, re-checks every $((INTERVAL/60)) min"
    install_remote_control "$CLAUDE_BIN"
    echo "claude:      $CLAUDE_BIN"
    echo "logs:        $LOG"
    echo "             $RC_LOG"
    exit 0
    ;;
  --uninstall)
    launchctl unload "$PLIST" 2>/dev/null
    launchctl unload "$RC_PLIST" 2>/dev/null
    rm -f "$PLIST" "$RC_PLIST"
    echo "removed — neither the task agent nor remote control will start at login"
    echo "(remoteControlAtStartup is still true in ~/.claude/settings.json; set it false to fully opt out)"
    exit 0
    ;;
  --status)
    if launchctl list 2>/dev/null | grep -q "$LABEL"; then
      echo "task agent:     LOADED — auto-starts at login"
    else
      echo "task agent:     NOT loaded — run: bash $0 --install"
    fi
    if launchctl list 2>/dev/null | grep -q "$RC_LABEL"; then
      echo "remote control: LOADED — auto-starts at login"
    else
      echo "remote control: NOT loaded — run: bash $0 --install-remote"
    fi
    grep -q '"remoteControlAtStartup": *true' "$HOME/.claude/settings.json" 2>/dev/null \
      && echo "settings.json:  remoteControlAtStartup = true" \
      || echo "settings.json:  remoteControlAtStartup NOT set"
    [[ -f "$RC_LOG" ]] && { echo "--- remote control log (last 8) ---"; tail -8 "$RC_LOG"; }
    [[ -f "$LOG" ]] && { echo "--- task agent log (last 15) ---"; tail -15 "$LOG"; }
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
