#!/bin/bash
# Obsidian Auto-Sync (Simple Version)
# Periodically check for changes and auto-commit

cd "$(dirname "$0")"

echo "🔍 Checking for Obsidian changes..."
echo "📅 $(date)"

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
    
    # Push to GitHub
    if git push origin main; then
        echo "✅ Successfully pushed to GitHub!"
        echo "📄 Files updated: $FILE_COUNT"
    else
        echo "❌ Failed to push to GitHub"
    fi
else
    echo "✅ No changes detected"
fi

echo "---" 