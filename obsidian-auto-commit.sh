#!/bin/bash
# Obsidian Auto-Commit Script
# Automatically commit and push changes made in Obsidian

cd "$(dirname "$0")"

# Check if there are any changes
if [[ -n $(git status --porcelain) ]]; then
    echo "📝 Obsidian changes detected..."
    echo "📅 $(date)"
    
    # Add all changes
    git add .
    
    # Get list of changed files
    CHANGED_FILES=$(git diff --cached --name-only | head -5)
    
    # Create commit message
    if [[ $(echo "$CHANGED_FILES" | wc -l) -eq 1 ]]; then
        FILENAME=$(basename "$CHANGED_FILES")
        COMMIT_MSG="📝 Update $FILENAME via Obsidian"
    else
        FILE_COUNT=$(echo "$CHANGED_FILES" | wc -l)
        COMMIT_MSG="📝 Update ${FILE_COUNT} files via Obsidian"
    fi
    
    # Commit changes
    git commit -m "$COMMIT_MSG

Auto-committed from Obsidian at $(date '+%Y-%m-%d %H:%M:%S')

Changed files:
$CHANGED_FILES"
    
    # Push to GitHub
    git push origin main
    
    echo "✅ Changes pushed to GitHub successfully"
    echo "📄 Files updated: $FILE_COUNT"
else
    echo "✅ No changes to commit"
fi 