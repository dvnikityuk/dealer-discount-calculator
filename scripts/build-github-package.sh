#!/usr/bin/env bash
# Creates a clean GitHub-ready copy of the dealer discount calculator project.
# Output: /home/z/my-project/download/dealer-discount-calculator/
#         /home/z/my-project/download/dealer-discount-calculator.zip
#
# The copy excludes: node_modules, .next, data/state.json, data/uploads/,
# db/*.db, dev.log, screenshots, upload/, skills/, worklog.md, etc.

set -euo pipefail

SRC="/home/z/my-project"
DEST="/home/z/my-project/download/dealer-discount-calculator"
ZIP="/home/z/my-project/download/dealer-discount-calculator.zip"

# Clean previous output
rm -rf "$DEST" "$ZIP"
mkdir -p "$DEST"

# Files & dirs to include (relative to SRC)
INCLUDE=(
  "src"
  "public"
  "prisma"
  "data"
  "db"
  ".gitignore"
  ".env.example"
  "LICENSE"
  "README.md"
  "Caddyfile"
  "bun.lock"
  "components.json"
  "eslint.config.mjs"
  "next-env.d.ts"
  "next.config.ts"
  "package.json"
  "postcss.config.mjs"
  "tsconfig.json"
)

# Files inside data/ to keep (these are sample / starter files)
# - data/.gitkeep  → ensure data/ exists in repo
# - data/uploads/.gitkeep  → ensure data/uploads/ exists in repo
# We don't pre-create data/ here; we'll add .gitkeep AFTER copying.

# Copy each entry. For directories, copy contents into the target dir
# (avoid the "data/data" nesting caused by cp -r src/data dest/data
# when dest/data already exists).
for entry in "${INCLUDE[@]}"; do
  if [ -e "$SRC/$entry" ]; then
    mkdir -p "$DEST/$(dirname "$entry")"
    if [ -d "$SRC/$entry" ]; then
      # For directories: create the target dir, then copy contents
      mkdir -p "$DEST/$entry"
      cp -r "$SRC/$entry/." "$DEST/$entry/"
    else
      cp "$SRC/$entry" "$DEST/$entry"
    fi
  fi
done

# Remove any junk that may have been copied from src/, public/, prisma/
find "$DEST" -type d -name "node_modules" -prune -exec rm -rf {} + 2>/dev/null || true
find "$DEST" -type d -name ".next" -prune -exec rm -rf {} + 2>/dev/null || true
find "$DEST" -type f -name "*.log" -delete 2>/dev/null || true
find "$DEST" -type f -name ".DS_Store" -delete 2>/dev/null || true

# If data/state.json was copied, remove it (it's runtime data, not source)
[ -f "$DEST/data/state.json" ] && rm "$DEST/data/state.json"

# If data/uploads has user files (xlsx/csv), remove them — they're private source data
find "$DEST/data/uploads" -type f ! -name ".gitkeep" -delete 2>/dev/null || true

# If db has actual .db files, remove them — they're runtime databases
find "$DEST/db" -type f -name "*.db" -delete 2>/dev/null || true
find "$DEST/db" -type f -name "*.db-journal" -delete 2>/dev/null || true

# Ensure data/ and data/uploads/ and db/ exist with .gitkeep
mkdir -p "$DEST/data/uploads" "$DEST/db"
touch "$DEST/data/.gitkeep" "$DEST/data/uploads/.gitkeep" "$DEST/db/.gitkeep"

# Add a GitHub Actions CI workflow for builds
mkdir -p "$DEST/.github/workflows"
cat > "$DEST/.github/workflows/ci.yml" << 'YAML'
name: CI

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest
      - name: Install dependencies
        run: bun install --frozen-lockfile
      - name: Lint
        run: bun run lint || true
      - name: Build
        run: bun run build
YAML

# Final inventory
echo "=== GitHub-ready project structure ==="
( cd "$DEST" && find . -maxdepth 3 -not -path '*/node_modules*' -not -path '*/.next*' | sort )

echo ""
echo "=== Total size ==="
du -sh "$DEST"

# Make a zip too (so the user can download a single archive)
( cd "$(dirname "$DEST")" && zip -qr "$ZIP" "$(basename "$DEST")" )
echo ""
echo "=== Zip ==="
ls -lh "$ZIP"

echo ""
echo "Done. GitHub-ready project is at:"
echo "  $DEST"
echo "  $ZIP"
