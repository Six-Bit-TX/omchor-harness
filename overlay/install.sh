#!/usr/bin/env bash
#
# Install (or reinstall) this overlay into a dsh profile.
#
# Copies every package under plugins/ into the profile's own module tree and
# makes sure each package has a Loader row in the profile's patch layer, leaving
# rows it does not own alone.
#
# Usage:
#   ./install.sh                 # profile "web" under $HOME/.dsh
#   DSH_HOME=/path ./install.sh  # a different harness home
#   DSH_PROFILE=other ./install.sh
#
set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${DSH_PROFILE:-web}"
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
TARGET_DIR="$PROFILE_DIR/node_modules/@local"
PATCH="$PROFILE_DIR/cordis.patch.yml"

if [ ! -d "$PROFILE_DIR" ]; then
  echo "install: no such profile: $PROFILE_DIR" >&2
  echo "install: start the profile once (for example: dsh web --profile $PROFILE) and run this again" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"

# 1. the packages: the profile's module tree is the only place the Loader looks.
for src in "$HERE"/plugins/*/; do
  [ -d "$src" ] || continue
  name="$(basename "$src")"
  rm -rf "$TARGET_DIR/$name"
  cp -R "$src" "$TARGET_DIR/"
  echo "installed  @local/$name"
done

# 2. the rows. A row is addressed by id, so one that is already present is left
#    exactly as it is: other tools and other plugins may share this file.
ensure_row() {
  local id="$1" name="$2"
  if grep -qE "^[[:space:]]*-[[:space:]]*id:[[:space:]]*['\"]?${id}['\"]?[[:space:]]*$" "$PATCH" 2>/dev/null; then
    echo "row        $id already present"
    return 0
  fi
  printf '\n# added by dsh-overlay install.sh\n- insert:\n    - id: %s\n      name: %s\n' "$id" "'@local/$name'" >> "$PATCH"
  echo "row        $id -> @local/$name"
}

if [ ! -f "$PATCH" ]; then
  printf '# dsh profile patch layer\n[]\n' > "$PATCH"
fi
# An empty-list marker cannot stand above appended list entries.
if grep -qE '^\[\][[:space:]]*$' "$PATCH"; then
  sed -i '/^\[\][[:space:]]*$/d' "$PATCH"
fi

ensure_row ui-video-preview dsh-client-ui-video-preview
ensure_row ui-video-preview-routes dsh-video-preview-routes
ensure_row ui-sidebar-terminal dsh-client-ui-sidebar-terminal
ensure_row ui-subagent-fanout dsh-subagent-fanout
ensure_row ui-subagent-subsession dsh-client-ui-subagent-subsession

echo
echo "done. A row added now is composed only when the profile boots, so the order is:"
echo "  1. restart 'dsh web' (patchReload:live reloads composed rows, not new ones)"
echo "  2. refresh the page (a new row enters a page's boot graph when it is fetched)."
echo
echo "Editing the source of a plugin that is already composed needs only a refresh."
