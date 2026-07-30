#!/bin/bash
set -euo pipefail

APP="$HOME/Applications/Asher Portal.app"
LAUNCHER="$HOME/.local/bin/portal"

printf '\nUninstalling Asher Portal...\n'

osascript -e 'tell application "Asher Portal" to quit' \
  >/dev/null 2>&1 || true

rm -rf "$APP"
rm -f "$LAUNCHER"
rm -rf "$HOME/Library/Application Support/Asher Portal"
rm -rf "$HOME/Library/Caches/com.ashermenachem.asherportal"
rm -rf "$HOME/Library/Caches/Asher Portal"
rm -f "$HOME/Library/Logs/AsherPortal.log"
rm -rf "$HOME/Library/Saved Application State/com.ashermenachem.asherportal.savedState"

printf '\nAsher Portal was removed.\n'
printf 'The harmless ~/.local/bin PATH entry remains in ~/.zshrc because other command-line apps may use it.\n\n'
