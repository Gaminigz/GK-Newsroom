#!/bin/bash
# =====================================================================
# yt-routine.sh — human-paced ADB helpers for driving TikTok + YouTube
# on an Android emulator (Pixel 7 AVD "yai-tik").
#
# Source this file from a scratchpad script (not exec'd), then call the
# helpers. Everything writes screenshots + UI dumps to $SP so we can
# inspect after each step.
#
#   source src/scripts/yt-routine.sh
#   htap 540 232          # tap with pixel jitter
#   pause 3 6             # random human-ish delay
#   b64type "some text"   # broadcast unicode via ADBKeyBoard (must be
#                         # active IME — see setup notes)
#
# Setup notes (one-time):
#   1. Boot AVD:                emulator -avd yai-tik -no-snapshot-save &
#   2. Install ADBKeyBoard.apk (Unicode input for Khmer / Chinese):
#        adb install ADBKeyBoard.apk
#        adb shell ime enable com.android.adbkeyboard/.AdbIME
#        adb shell ime set    com.android.adbkeyboard/.AdbIME
#   3. Log in to TikTok + YouTube manually (once per AVD).
# =====================================================================

SP="${YAI_SCRATCH:-/tmp/yai-newsroom}"
mkdir -p "$SP"

# --------- primitives ---------
rnd() { python3 -c "import random,sys; print(random.randint(int(sys.argv[1]),int(sys.argv[2])))" "$1" "$2"; }
pause() { sleep "$(python3 -c "import random; print(round(random.uniform(${1:-2}, ${2:-5}), 2))")"; }

# --------- ADB helpers ---------
dump() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 && adb pull /sdcard/ui.xml "$SP/ui.xml" >/dev/null 2>&1; }

# htap: tap with pixel jitter. Two calling styles:
#   htap 540 232         → integers
#   htap "540 232"       → single string (what find_node returns)
htap() {
  local x y j jx jy
  if [ $# -ge 2 ]; then
    x=$1; y=$2; j=${3:-6}
  else
    x=$(echo "$1" | awk '{print $1}')
    y=$(echo "$1" | awk '{print $2}')
    j=6
  fi
  jx=$(rnd -$j $j); jy=$(rnd -$j $j)
  adb shell input tap $((x+jx)) $((y+jy))
}

# find_node NEEDLE — echoes "X Y" of the first ui element whose <node ...>
# tag contains NEEDLE, using the last-dumped UI hierarchy.
find_node() {
  python3 - "$1" <<'PY'
import re, sys
xml = open("__SP__/ui.xml").read()
needle = sys.argv[1]
for m in re.finditer(r'<node[^>]+>', xml):
    tag = m.group(0)
    if needle not in tag: continue
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', tag)
    if b:
        x1,y1,x2,y2 = map(int, b.groups())
        print(f'{(x1+x2)//2} {(y1+y2)//2}')
        break
PY
}
# Substitute the scratchpad path since heredoc doesn't expand shell vars.
find_node() {
  local sp=$SP
  python3 -c "
import re, sys
xml = open('$sp/ui.xml').read()
needle = sys.argv[1]
for m in re.finditer(r'<node[^>]+>', xml):
    tag = m.group(0)
    if needle not in tag: continue
    b = re.search(r'bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"', tag)
    if b:
        x1,y1,x2,y2 = map(int, b.groups())
        print(f'{(x1+x2)//2} {(y1+y2)//2}')
        break
" "$1"
}

# tap_node NEEDLE — dump + find + tap in one shot.
tap_node() {
  local c
  c=$(dump >/dev/null; find_node "$1")
  if [ -n "$c" ]; then htap "$c"; return 0; fi
  return 1
}

# b64type "..." — types text via ADBKeyBoard's base64 intent. Handles
# emoji, Khmer, Chinese, embedded newlines, apostrophes, everything.
b64type() {
  local B
  B=$(echo -n "$1" | base64)
  adb shell "am broadcast -a ADB_INPUT_B64 --es msg '$B'" >/dev/null 2>&1
}

# clear_field [N] — moves cursor to end, sends N backspaces (default 120).
clear_field() {
  adb shell input keyevent 123 >/dev/null
  local n=${1:-120}
  for i in $(seq 1 $n); do
    adb shell input keyevent 67 >/dev/null
    sleep 0.02
  done
}

# wait_for NEEDLE [TIMEOUT_S] — polls dump() until NEEDLE appears.
wait_for() {
  local t=0 needle=$1 timeout=${2:-360}
  until dump && grep -q "$needle" "$SP/ui.xml"; do
    sleep 5; t=$((t+5))
    if [ $t -ge $timeout ]; then return 1; fi
  done
  return 0
}

shot() { adb shell screencap -p > "$SP/${1:-shot}.png"; }

# --------- higher-level flows ---------

# yt_veo_prompt "PROMPT" — from YouTube home, opens the AI-Playground
# Create-Video flow, types PROMPT, hits Create, waits until the editor
# shows the "Add sound" pill (means Veo generation finished).
yt_veo_prompt() {
  adb shell am start -n com.google.android.youtube/com.google.android.apps.youtube.app.WatchWhileActivity >/dev/null 2>&1
  pause 4 6
  htap 540 2283; pause 3 5                   # + create
  dump && grep -q "Try this sound" "$SP/ui.xml" && { htap 646 370; pause 1 2; }
  htap 984 286; pause 4 6                    # AI-Playground sparkle
  htap 156 394; pause 4 6                    # Create video tile
  htap 540 348; pause 2 3                    # focus prompt
  adb shell ime set com.android.adbkeyboard/.AdbIME >/dev/null
  clear_field 80
  b64type "$1"; pause 2 3
  adb shell input keyevent 111; pause 1 2    # dismiss kb
  htap 540 2077                              # Create button
  wait_for "Add sound" 540
}

# yt_pipeline "OVERLAY_TEXT" "CAPTION" — full post from a ready editor
# state: search epic music, add, duck to ~25%, apply Pop filter, add big
# bold text overlay, drag it up, Next, caption, Upload Short.
yt_pipeline() {
  local overlay=$1 caption=$2

  # music: search "epic cinematic" and take the 3rd result (Adventure Trailer)
  htap 540 232; pause 4 6                    # Add sound pill
  dump && local C=$(find_node 'text="Search"'); htap "$C"; pause 2 3
  adb shell ime set com.android.adbkeyboard/.AdbIME >/dev/null
  b64type "epic cinematic"; pause 2 3
  adb shell input keyevent 66; pause 5 7     # enter
  htap 104 1160; pause 2 3                   # preview row 3 album art
  dump && C=$(find_node "Add this music to your video"); [ -n "$C" ] && { htap "$C"; pause 4 6; }

  # duck music to ~25%
  htap 995 231; pause 3 4                    # volume mixer icon
  adb shell input touchscreen swipe 1025 2233 281 2233 750; pause 1 2
  htap 1018 1770; pause 2 3                  # ✓ confirm

  # Pop filter (1st tile = sharpest look)
  htap 985 1160; pause 3 4                   # Filters icon
  htap 104 2126; pause 2 3                   # Pop
  htap 1016 1990; pause 2 3                  # ✓ confirm

  # text overlay
  htap 985 780; pause 3 4                    # Aa icon
  b64type "$overlay"; pause 2 3
  dump && C=$(find_node 'text="Done"'); [ -z "$C" ] && C="973 210"; htap "$C"; pause 2 3
  adb shell input touchscreen swipe 540 1185 540 780 700; pause 2 3  # drag up

  # Next
  dump && C=$(find_node 'text="Next"'); [ -n "$C" ] && htap "$C"; pause 7 9

  # caption
  dump && C=$(find_node "Caption your Short"); [ -z "$C" ] && C="462 350"; htap "$C"; pause 2 3
  adb shell ime set com.android.adbkeyboard/.AdbIME >/dev/null
  b64type "$caption"; pause 2 3
  adb shell input keyevent 111; pause 1 2

  # Upload
  dump && C=$(find_node "Upload Short"); [ -n "$C" ] && htap "$C"
  pause 6 8
}
