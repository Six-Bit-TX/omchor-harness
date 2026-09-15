#!/usr/bin/env bash
#
# Remove this overlay's packages from a dsh profile.
#
# It deletes only the package directories it owns. It deliberately does NOT edit
# the patch layer: that file is shared with whatever else you (or another tool)
# put in it, so the rows are printed for you to delete by id.
#
set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${DSH_PROFILE:-web}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
TARGET_DIR="$PROFILE_DIR/node_modules/@local"
PATCH="$PROFILE_DIR/cordis.patch.yml"

for name in dsh-client-ui-video-preview dsh-video-preview-routes dsh-client-ui-sidebar-terminal dsh-subagent-fanout dsh-client-ui-subagent-subsession; do
  if [ -d "$TARGET_DIR/$name" ]; then
    rm -rf "$TARGET_DIR/$name"
    echo "removed    @local/$name"
  fi
done

cat <<EOF

Now delete these rows from $PATCH (and any comment block above them):

  - id: ui-video-preview
  - id: ui-video-preview-routes
  - id: ui-sidebar-terminal
  - id: ui-subagent-fanout
  - id: ui-subagent-subsession

Each row sits inside an "- insert:" list; delete the row line and the "name:" line
beneath it, then restart dsh web and reload the page.
EOF
