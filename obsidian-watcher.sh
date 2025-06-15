#!/bin/bash
# Obsidian File Watcher
# Monitors file changes and auto-commits to GitHub

WATCH_DIR="$(dirname "$0")"
SCRIPT_DIR="$WATCH_DIR"

echo "🔍 Starting Obsidian file watcher..."
echo "📁 Watching directory: $WATCH_DIR"
echo "⏰ Started at: $(date)"

# Install fswatch if not available
if ! command -v fswatch &> /dev/null; then
    echo "📦 Installing fswatch..."
    brew install fswatch
fi

# Function to handle file changes
handle_change() {
    echo "📝 File change detected at $(date)"
    sleep 2  # Wait for file operations to complete
    "$SCRIPT_DIR/obsidian-auto-commit.sh"
    echo "---"
}

# Watch for changes in markdown files and task files
fswatch -o \
    --event Created \
    --event Updated \
    --event Removed \
    --exclude "\.git/" \
    --exclude "\.obsidian/" \
    --exclude "node_modules/" \
    --exclude "\.DS_Store" \
    --include "\.md$" \
    "$WATCH_DIR" | while read num; do
    handle_change
done 