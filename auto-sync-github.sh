#!/bin/bash

# NOROSHI Auto-Sync Script for GitHub → Cursor
# Slackからの変更を自動的にCursorに反映

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ログファイル
LOG_FILE="$SCRIPT_DIR/auto-sync.log"
DATE=$(date '+%Y-%m-%d %H:%M:%S')

echo "[$DATE] 🔄 Auto-sync started" >> "$LOG_FILE"

# Git status確認
if ! git status &>/dev/null; then
    echo "[$DATE] ❌ Not a git repository" >> "$LOG_FILE"
    exit 1
fi

# リモートの変更をチェック（より頻繁に）
git fetch origin main &>/dev/null

# ローカルとリモートの差分をチェック
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" != "$REMOTE" ]; then
    echo "[$DATE] 📥 New changes detected from GitHub" >> "$LOG_FILE"
    
    # ローカルに未コミットの変更があるかチェック
    if ! git diff-index --quiet HEAD --; then
        echo "[$DATE] 💾 Stashing local changes" >> "$LOG_FILE"
        git stash push -m "Auto-stash before sync $(date)"
    fi
    
    # リモートの変更をプル
    if git pull origin main --no-edit &>/dev/null; then
        echo "[$DATE] ✅ Successfully pulled changes from GitHub" >> "$LOG_FILE"
        
        # タスクファイルの変更をチェック
        CHANGED_FILES=$(git diff --name-only HEAD~1 HEAD | grep "タスク/.*\.md" || true)
        if [ -n "$CHANGED_FILES" ]; then
            echo "[$DATE] 📋 Task files updated: $CHANGED_FILES" >> "$LOG_FILE"
            
            # VS Code/Cursorに通知（ファイルが開かれている場合は自動リロード）
            if command -v osascript &>/dev/null; then
                osascript -e 'display notification "タスクファイルが更新されました - Cursorで確認してください" with title "NOROSHI Auto-Sync" sound name "Glass"' 2>/dev/null || true
            fi
            
            # VS Code/Cursorのワークスペースをリロード（可能な場合）
            if command -v code &>/dev/null; then
                # VS Codeが開いている場合、ワークスペースをリロード
                code --reuse-window "$SCRIPT_DIR" 2>/dev/null || true
            fi
        fi
        
        # Stashした変更があれば復元
        if git stash list | grep -q "Auto-stash before sync"; then
            echo "[$DATE] 🔄 Restoring stashed changes" >> "$LOG_FILE"
            git stash pop &>/dev/null || true
        fi
        
    else
        echo "[$DATE] ❌ Failed to pull changes" >> "$LOG_FILE"
        exit 1
    fi
else
    echo "[$DATE] ✅ Already up to date" >> "$LOG_FILE"
fi

echo "[$DATE] 🔄 Auto-sync completed" >> "$LOG_FILE" 