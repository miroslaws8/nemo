#!/usr/bin/env bash
# Links the app's Hermes skills, their shared contract and the page-marking helper from this repo
# into ~/.hermes, so Hermes runs exactly what is committed here (edit the skills in the repo). Safe
# to run again.
set -euo pipefail

HERMES_DIR="$HOME/.hermes"
QA_OUTPUT_DIR="$HOME/nemo-output"
REPO_HERMES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$HERMES_DIR/backup-$(date +%Y%m%d-%H%M%S)"

# Points $2 at $1. A real file or folder already at $2 is moved to the backup folder first.
link() {
  local source="$1" target="$2"
  if [ -L "$target" ]; then
    rm "$target"
  elif [ -e "$target" ]; then
    mkdir -p "$BACKUP_DIR"
    mv "$target" "$BACKUP_DIR/"
    echo "backed up $target → $BACKUP_DIR/"
  fi
  ln -s "$source" "$target"
  echo "linked $target → $source"
}

mkdir -p "$HERMES_DIR/skills"
link "$REPO_HERMES_DIR/qa-shared.md" "$HERMES_DIR/qa-shared.md"
link "$REPO_HERMES_DIR/qa-mark.js" "$HERMES_DIR/qa-mark.js"
for skill in "$REPO_HERMES_DIR"/skills/qa-*/; do
  link "${skill%/}" "$HERMES_DIR/skills/$(basename "$skill")"
done

# Skills that drive the browser from a script carry their own Playwright dependencies.
for scripts in "$REPO_HERMES_DIR"/skills/*/scripts; do
  if [ -f "$scripts/pnpm-lock.yaml" ]; then
    echo "installing ${scripts#"$REPO_HERMES_DIR"/}"
    (cd "$scripts" && pnpm install --frozen-lockfile --silent && pnpm exec playwright install chromium)
  fi
done

# Skills save screenshots under ~/nemo-output/smoke-screens/<env>/<skill>/. To keep them somewhere
# else, make ~/nemo-output a symlink to that folder before running this script.
if [ ! -e "$QA_OUTPUT_DIR" ]; then
  mkdir -p "$QA_OUTPUT_DIR"
  echo "created $QA_OUTPUT_DIR"
fi

echo "Done. Credentials stay in the Hermes vault and $HERMES_DIR/.env (QA_* keys), never here."
# Most skills live in the QA console's skill store, not in git: pnpm skills:pull writes them in.
echo "Skills from the skill store: pnpm skills:pull (QA_CONSOLE_SKILLS_* in nemo's .env; docs/guide.md → Skills)."
