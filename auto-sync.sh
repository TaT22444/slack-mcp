#!/bin/bash
# NOROSHI Auto-Sync Script
# Run this script periodically to keep local repo in sync

cd "$(dirname "$0")"

echo "🔄 NOROSHI Auto-Sync Starting..."
echo "📅 $(date)"

# Fetch latest changes
git fetch origin main

# Check if there are new commits
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" != "$REMOTE" ]; then
    echo "🆕 New changes detected, pulling..."
    git pull origin main --no-edit
    echo "✅ Sync completed successfully"
else
    echo "✅ Already up to date"
fi

echo "🏁 Auto-Sync finished" 