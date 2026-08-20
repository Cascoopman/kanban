# Reliable Laptop + External Display Layout

## Contents

1. [Target layout](#target-layout)
2. [Why not DeskJockey](#why-not-deskjockey)
3. [Design](#design)
4. [Agent-native setup prompt](#agent-native-setup-prompt)
5. [Manual implementation](#manual-implementation)
6. [Managing and troubleshooting](#managing-and-troubleshooting)

## Target layout

Use this procedure for a laptop with exactly one external monitor:

- Make the external monitor the main display at origin (0,0).
- Place the laptop display directly below it, horizontally centred.
- Preserve the live resolution, refresh rate, colour depth, and scaling for
  both displays.
- Do nothing when the laptop is undocked or more than one external display is
  connected.

The safety constraint is important: an automation for a simple desk setup must
not overwrite a multi-monitor arrangement.

## Why not DeskJockey

DeskJockey profiles can be unsuitable when either of these conditions applies:

1. The app rewrites its saved profile from the current live arrangement. A
   reconnect that lets macOS choose the wrong default can silently overwrite a
   working profile, making manual JSON edits ineffective.
2. An external display reports a changing serial number. The profile matcher
   may treat each reconnect as a new display, fall back to the macOS default,
   and then save that fallback arrangement.

Replace competing display managers before enabling this setup. Two managers
trying to restore a layout will fight each other.

## Design

Use displayplacer because it applies an arrangement and exits; it has no
profile daemon or hidden state. On each run, re-read the current display IDs:
the external monitor can change its reported serial number without breaking
the arrangement.

Use a local script with two modes:

- Default mode: make one arrangement pass.
- --watch mode: poll the enabled-screen signature about every three seconds
  and reapply only after a connect or disconnect.

Keep the watcher alive with a per-user launchd LaunchAgent. This is
edge-triggered by the watcher's screen-signature change, not a continuous
fight against manual adjustments. Run the script manually to reassert the
layout without reconnecting a monitor.

## Agent-native setup prompt

Give this prompt to a coding agent when you want it to create the local
configuration:

~~~text
Set up automatic display arrangement on my Mac using displayplacer.

I have a laptop plus one external monitor. I want the external screen to be
the main display at origin (0,0), and my laptop screen centered directly below
it.

Requirements:
- Install displayplacer with Homebrew if it is not already installed.
- Write ~/.local/bin/arrange-screens.sh. It must:
  - re-detect display IDs on every run, so changing monitor serial numbers do
    not matter;
  - act only when exactly one built-in and one external screen are connected;
  - preserve each screen's current resolution, refresh rate, and scaling;
  - place the external display at origin (0,0) and centre the laptop below it;
  - support --watch mode and reapply when the set of connected displays
    changes, polling about every three seconds.
- Install a per-user launchd LaunchAgent that runs at login, keeps the watcher
  alive, loads it, and verifies it by deliberately misplacing the laptop
  display and confirming that the next reconnect restores the layout.
- Show the log location and the exact uninstallation steps.

Remove DeskJockey or another display manager first if it would compete for the
same layout.
~~~

## Manual implementation

### 1. Install displayplacer

~~~sh
brew install displayplacer
~~~

### 2. Create the arrangement script

Create ~/.local/bin/arrange-screens.sh:

~~~bash
#!/bin/bash
# Auto-arrange one laptop display and one external display:
#   - external display at origin (0,0)
#   - built-in display centred directly below it
#
# Display IDs are re-read every run. A changing monitor serial number therefore
# does not matter. Each display retains its current resolution/refresh/scaling.
#
# Usage:
#   arrange-screens.sh
#   arrange-screens.sh --watch

DP="/opt/homebrew/bin/displayplacer"
[ -x "$DP" ] || DP="$(command -v displayplacer 2>/dev/null)"
LOG="${HOME}/Library/Logs/arrange-screens.log"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }

# Print persistent ID, type, resolution, hertz, colour depth, and scaling for
# each enabled display.
parse_screens() {
  "$DP" list 2>/dev/null | awk '
    /^Persistent screen id:/ {pid=$4}
    /^Type:/        {t=$0; sub(/^Type: /,"",t); type=t}
    /^Resolution:/  {res=$2}
    /^Hertz:/       {hz=$2}
    /^Color Depth:/ {cd=$3}
    /^Scaling:/     {sc=$2}
    /^Enabled:/     {if ($2=="true") print pid"|"type"|"res"|"hz"|"cd"|"sc}
  '
}

signature() {
  "$DP" list 2>/dev/null | awk '
    /^Persistent screen id:/ {pid=$4}
    /^Enabled:/ {if ($2=="true") print pid}
  ' | sort | tr "\n" ","
}

arrange() {
  if [ -z "$DP" ] || [ ! -x "$DP" ]; then
    log "ERROR: displayplacer not found"
    return 1
  fi

  local lap_id="" lap_res="" lap_hz="" lap_cd="" lap_sc=""
  local ext_id="" ext_res="" ext_hz="" ext_cd="" ext_sc=""
  local lap_count=0 ext_count=0
  local pid type res hz cd sc

  while IFS='|' read -r pid type res hz cd sc; do
    [ -n "$pid" ] || continue
    if printf '%s' "$type" | grep -qi "built in"; then
      lap_count=$((lap_count + 1))
      lap_id="$pid"; lap_res="$res"; lap_hz="$hz"; lap_cd="$cd"; lap_sc="$sc"
    else
      ext_count=$((ext_count + 1))
      ext_id="$pid"; ext_res="$res"; ext_hz="$hz"; ext_cd="$cd"; ext_sc="$sc"
    fi
  done <<< "$(parse_screens)"

  if [ "$lap_count" -ne 1 ] || [ "$ext_count" -ne 1 ]; then
    log "skip: built-in=$lap_count external=$ext_count (need exactly 1 + 1)"
    return 0
  fi

  local extW extH lapW lapX lapY
  extW="${ext_res%x*}"; extH="${ext_res#*x}"
  lapW="${lap_res%x*}"

  if ! [ "$extW" -gt 0 ] 2>/dev/null || ! [ "$lapW" -gt 0 ] 2>/dev/null; then
    log "ERROR: could not parse resolutions ext='$ext_res' lap='$lap_res'"
    return 1
  fi

  lapX=$(( (extW - lapW) / 2 ))
  lapY="$extH"

  log "arrange: ext=$ext_id ${ext_res} @(0,0) main | lap=$lap_id ${lap_res} @(${lapX},${lapY})"

  "$DP" \
    "id:${ext_id} res:${ext_res} hz:${ext_hz} color_depth:${ext_cd} enabled:true scaling:${ext_sc} origin:(0,0) degree:0" \
    "id:${lap_id} res:${lap_res} hz:${lap_hz} color_depth:${lap_cd} enabled:true scaling:${lap_sc} origin:(${lapX},${lapY}) degree:0" \
    >> "$LOG" 2>&1 || log "ERROR: displayplacer apply failed"
}

case "${1:-}" in
  --watch)
    log "watcher started (pid $$)"
    prev=""
    while true; do
      cur="$(signature)"
      if [ -n "$cur" ] && [ "$cur" != "$prev" ]; then
        log "change detected: [$cur]"
        arrange
        prev="$cur"
      fi
      sleep 3
    done
    ;;
  *) arrange ;;
esac
~~~

Make it executable:

~~~sh
chmod +x ~/.local/bin/arrange-screens.sh
~~~

### 3. Create the LaunchAgent

Create a per-user LaunchAgent at
~/Library/LaunchAgents/com.<you>.arrangescreens.plist. Replace every
/Users/you value with the actual home path: launchd does not expand $HOME in
plist arguments or log paths.

~~~xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.you.arrangescreens</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/Users/you/.local/bin/arrange-screens.sh</string>
        <string>--watch</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProcessType</key>
    <string>Background</string>
    <key>StandardOutPath</key>
    <string>/Users/you/Library/Logs/arrange-screens.out.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/you/Library/Logs/arrange-screens.err.log</string>
</dict>
</plist>
~~~

### 4. Load and verify

~~~sh
launchctl bootstrap gui/$(id -u) \
  ~/Library/LaunchAgents/com.you.arrangescreens.plist
launchctl list | grep arrangescreens
tail -f ~/Library/Logs/arrange-screens.log
~~~

Confirm a manually misplaced screen is restored after a reconnect. The watcher
is intentionally edge-triggered, so it does not revert manual adjustment until
the display set changes. Run ~/.local/bin/arrange-screens.sh to apply the
layout immediately.

## Managing and troubleshooting

~~~sh
# Run one arrangement pass.
~/.local/bin/arrange-screens.sh

# Stop and start the watcher.
launchctl bootout gui/$(id -u)/com.you.arrangescreens
launchctl bootstrap gui/$(id -u) \
  ~/Library/LaunchAgents/com.you.arrangescreens.plist

# Uninstall.
launchctl bootout gui/$(id -u)/com.you.arrangescreens
rm ~/Library/LaunchAgents/com.you.arrangescreens.plist \
  ~/.local/bin/arrange-screens.sh
~~~

To put the laptop above the external display, set the laptop Y coordinate to a
negative laptop height. To left-align instead of centre, replace the X
calculation. Re-check displayplacer list and test the changed layout before
enabling the watcher.
