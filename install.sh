#!/bin/bash
set -euo pipefail

REPOSITORY="ashermenachem/asher-portal"
APP_NAME="Asher Portal"
APP_DIRECTORY="$HOME/Applications"
APP_DESTINATION="$APP_DIRECTORY/$APP_NAME.app"
BIN_DIRECTORY="$HOME/.local/bin"
LAUNCHER="$BIN_DIRECTORY/portal"
PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'

fail() {
  printf '\nAsher Portal installation failed: %s\n\n' "$1" >&2
  exit 1
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "Asher Portal currently supports macOS only."
fi

for required_command in curl shasum ditto find mktemp; do
  command -v "$required_command" >/dev/null 2>&1 \
    || fail "Required macOS command is missing: $required_command"
done

case "$(uname -m)" in
  arm64) ARCHITECTURE="arm64" ;;
  x86_64) ARCHITECTURE="x64" ;;
  *) fail "Unsupported Mac architecture: $(uname -m)" ;;
esac

ASSET_NAME="Asher-Portal-macOS-${ARCHITECTURE}.zip"
CHECKSUM_NAME="${ASSET_NAME}.sha256"
DOWNLOAD_BASE="https://github.com/${REPOSITORY}/releases/latest/download"
ASSET_URL="${DOWNLOAD_BASE}/${ASSET_NAME}"
CHECKSUM_URL="${DOWNLOAD_BASE}/${CHECKSUM_NAME}"

TEMPORARY_DIRECTORY="$(mktemp -d "${TMPDIR:-/tmp}/asher-portal.XXXXXX")"

cleanup() {
  rm -rf "$TEMPORARY_DIRECTORY"
}
trap cleanup EXIT

printf '\n'
printf '╭──────────────────────────────────────╮\n'
printf '│          ASHER PORTAL INSTALLER      │\n'
printf '╰──────────────────────────────────────╯\n'
printf '\nDetected architecture: %s\n' "$ARCHITECTURE"
printf 'Downloading the latest release...\n\n'

curl --fail --location --progress-bar \
  "$ASSET_URL" \
  --output "$TEMPORARY_DIRECTORY/$ASSET_NAME" \
  || fail "Could not download $ASSET_NAME. The release may not exist yet."

curl --fail --location --silent --show-error \
  "$CHECKSUM_URL" \
  --output "$TEMPORARY_DIRECTORY/$CHECKSUM_NAME" \
  || fail "Could not download the release checksum."

printf '\nVerifying release integrity...\n'

(
  cd "$TEMPORARY_DIRECTORY"
  shasum -a 256 -c "$CHECKSUM_NAME"
) || fail "The downloaded release failed checksum verification."

printf 'Extracting application...\n'

mkdir -p "$TEMPORARY_DIRECTORY/extracted"

ditto -x -k \
  "$TEMPORARY_DIRECTORY/$ASSET_NAME" \
  "$TEMPORARY_DIRECTORY/extracted"

APP_SOURCE="$(
  find "$TEMPORARY_DIRECTORY/extracted" \
    -maxdepth 4 \
    -type d \
    -name "$APP_NAME.app" \
    -print \
    -quit
)"

[[ -n "$APP_SOURCE" && -d "$APP_SOURCE" ]] \
  || fail "The archive did not contain $APP_NAME.app."

osascript -e 'tell application "Asher Portal" to quit' \
  >/dev/null 2>&1 || true

mkdir -p "$APP_DIRECTORY"
rm -rf "$APP_DESTINATION"
ditto "$APP_SOURCE" "$APP_DESTINATION"

# The current public build is not Apple-notarized. The archive is verified
# against the SHA-256 checksum published by the release workflow first.
xattr -dr com.apple.quarantine "$APP_DESTINATION" 2>/dev/null || true

mkdir -p "$BIN_DIRECTORY"

cat > "$LAUNCHER" <<'LAUNCHER_EOF'
#!/bin/zsh
APP="$HOME/Applications/Asher Portal.app"

if [[ ! -d "$APP" ]]; then
  echo "Asher Portal is not installed at:"
  echo "$APP"
  exit 1
fi

open "$APP"
LAUNCHER_EOF

chmod +x "$LAUNCHER"
touch "$HOME/.zshrc"

if ! grep -Fqx "$PATH_LINE" "$HOME/.zshrc"; then
  printf '\n%s\n' "$PATH_LINE" >> "$HOME/.zshrc"
fi

printf '\nAsher Portal was installed successfully.\n\n'
printf 'Application:\n  %s\n\n' "$APP_DESTINATION"
printf 'Launcher:\n  %s\n\n' "$LAUNCHER"
printf 'Open a new Terminal window and run:\n  portal\n\n'

open "$APP_DESTINATION"
