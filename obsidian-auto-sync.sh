#!/bin/bash
# Obsidian Auto-Sync (Enhanced Version)
# Periodically check for changes and auto-commit with conflict resolution

cd "$(dirname "$0")"

echo "🔍 Checking for Obsidian changes..."
echo "📅 $(date)"

# First, fetch latest changes from remote
echo "🔄 Fetching latest changes from GitHub..."
git fetch origin main

# Check if there are any changes
if [[ -n $(git status --porcelain) ]]; then
    echo "📝 Changes detected in Obsidian files!"
    
    # Show what changed
    git status --short
    
    # Add all changes
    git add .
    
    # Get list of changed files
    CHANGED_FILES=$(git diff --cached --name-only)
    FILE_COUNT=$(echo "$CHANGED_FILES" | wc -l | tr -d ' ')
    
    # Create commit message
    if [[ $FILE_COUNT -eq 1 ]]; then
        FILENAME=$(basename "$CHANGED_FILES")
        COMMIT_MSG="📝 Update $FILENAME via Obsidian"
    else
        COMMIT_MSG="📝 Update ${FILE_COUNT} files via Obsidian"
    fi
    
    # Commit changes
    git commit -m "$COMMIT_MSG

Auto-committed from Obsidian at $(date '+%Y-%m-%d %H:%M:%S')

Changed files:
$CHANGED_FILES"
    
    # Pull latest changes before pushing
    echo "🔄 Pulling latest changes before push..."
    if git pull origin main --no-edit; then
        echo "✅ Successfully merged remote changes"
    else
        echo "⚠️ Merge conflicts detected, attempting auto-resolution..."
        # Auto-resolve conflicts by preferring our changes for markdown files
        git status --porcelain | grep "^UU" | while read status file; do
            if [[ "$file" == *.md ]]; then
                echo "🔧 Auto-resolving conflict in $file (keeping our version)"
                git checkout --ours "$file"
                git add "$file"
            fi
        done
        git commit -m "🔧 Auto-resolve merge conflicts (Obsidian priority)" || true
    fi
    
    # Push to GitHub
    if git push origin main; then
        echo "✅ Successfully pushed to GitHub!"
        echo "📄 Files updated: $FILE_COUNT"
    else
        echo "❌ Failed to push to GitHub"
        echo "🔍 Git status:"
        git status --short
    fi
else
    echo "✅ No changes detected"
fi

echo "---" 