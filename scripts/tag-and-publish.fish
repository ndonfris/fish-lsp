#!/usr/bin/env fish

#
# tag-and-publish.fish
#
# Enhanced script for bumping versions and publishing fish-lsp
#
# Usage:
#   ./scripts/tag-and-publish.fish [--bump|--bump-pre|--bump-patch|--bump-minor] [--dry-run]
#
# Options:
#   --bump        Auto-increment using existing logic (current behavior)
#   --bump-pre    Increment prerelease number only (1.0.11-pre.10 → 1.0.11-pre.11)
#   --bump-patch  Increment patch version (1.0.11 → 1.0.12)
#   --bump-minor  Increment minor version (1.0.11 → 1.1.0)
#   --dry-run     Show what would happen without executing
#

# Parse command line arguments
argparse --name='tag-and-publish' \
    h/help \
    d/dry-run \
    bump \
    bump-pre \
    bump-patch \
    bump-minor \
    use-current \
    -- $argv
or exit 1

if set -q _flag_help
    echo "Usage: tag-and-publish.fish [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -h, --help        Show this help message"
    echo "  -d, --dry-run     Show what would happen without executing"
    echo "  --bump            Auto-increment using existing logic (default)"
    echo "  --bump-pre        Increment prerelease number only"
    echo "  --bump-patch      Increment patch version"
    echo "  --bump-minor      Increment minor version"
    echo "  --use-current     Use current package.json version instead of calculating from npm"
    echo ""
    echo "Examples:"
    echo "  ./scripts/tag-and-publish.fish --bump-pre --dry-run"
    echo "  ./scripts/tag-and-publish.fish --bump-patch"
    echo "  ./scripts/tag-and-publish.fish --bump-minor"
    echo "  ./scripts/tag-and-publish.fish --use-current --dry-run"
    exit 0
end

source ./scripts/continue_or_exit.fish

# Determine which bump type to use
set -l bump_type "auto"
if set -q _flag_bump_pre
    set bump_type "pre"
else if set -q _flag_bump_patch
    set bump_type "patch"
else if set -q _flag_bump_minor
    set bump_type "minor"
else if set -q _flag_bump
    set bump_type "auto"
end

# Function to calculate new version
function calculate_new_version --argument bump_type
    set -l current_version (npm pkg get version | string unescape)
    
    switch $bump_type
        case "pre"
            # Increment prerelease number
            set -l v (npm show "fish-lsp@preminor" version 2>/dev/null)
            if test $status -ne 0
                echo "Error: Could not fetch preminor version" >&2
                return 1
            end
            
            # Parse version like "1.0.11-pre.9" -> "1.0.11-pre." and "9"
            if string match -qr '\d+\.\d+\.\d+-pre\.\d+' -- $v
                set -l vt (string replace -r '(\d+\.\d+\.\d+-pre\.)\d+' '$1' -- $v)
                set -l vn (string match -rg '\d+\.\d+\.\d+-pre\.(\d+)' -- $v)
                set -l nvn (math $vn + 1)
                echo "$vt$nvn"
            else
                echo "Error: Could not parse preminor version format: $v" >&2
                return 1
            end
            
        case "patch"
            # Increment patch version (1.0.11 → 1.0.12)
            set -l parts (string split '.' -- $current_version | string split '-')
            set -l major $parts[1]
            set -l minor $parts[2]
            set -l patch (string match -rg '(\d+)' -- $parts[3])
            set -l new_patch (math $patch + 1)
            echo "$major.$minor.$new_patch"
            
        case "minor"
            # Increment minor version (1.0.11 → 1.1.0)
            set -l parts (string split '.' -- $current_version | string split '-')
            set -l major $parts[1]
            set -l minor $parts[2]
            set -l new_minor (math $minor + 1)
            echo "$major.$new_minor.0"
            
        case "auto"
            # Use existing logic - increment based on preminor
            set -l v (npm show "fish-lsp@preminor" version 2>/dev/null)
            if test $status -ne 0
                echo "Error: Could not fetch preminor version" >&2
                return 1
            end
            
            # Parse version like "1.0.11-pre.9" -> "1.0.11-pre." and "9"
            if string match -qr '\d+\.\d+\.\d+-pre\.\d+' -- $v
                set -l vt (string replace -r '(\d+\.\d+\.\d+-pre\.)\d+' '$1' -- $v)
                set -l vn (string match -rg '\d+\.\d+\.\d+-pre\.(\d+)' -- $v)
                set -l nvn (math $vn + 1)
                echo "$vt$nvn"
            else
                echo "Error: Could not parse preminor version format: $v" >&2
                return 1
            end
            
        case "*"
            echo "Error: Unknown bump type: $bump_type" >&2
            return 1
    end
end

# Calculate new version
echo "🔍 Calculating new version..."
set -l current_version (npm pkg get version | string unescape)
echo "   Current version: $current_version"

if set -q _flag_use_current
    set -l new_version $current_version
    echo "   Using current package.json version: $new_version"
    echo "   Mode: use-current"
else
    set -l new_version (calculate_new_version $bump_type)
    if test $status -ne 0
        echo "❌ Failed to calculate new version"
        exit 1
    end
    echo "   New version: $new_version"
    echo "   Bump type: $bump_type"
end

# Check if version already exists
set -l tag_request "fish-lsp@$new_version"
echo ""
echo "🔍 Checking if version exists..."
npm show $tag_request version &>/dev/null

if test $status -eq 0
    echo "❌ Tag $new_version already exists, skipping tag and publish"
    exit 0
end

echo "✅ Version $new_version is available"

# Dry run mode
if set -q _flag_dry_run
    echo ""
    echo "🧪 DRY RUN MODE - No changes will be made"
    echo ""
    echo "Would perform the following actions:"
    echo "  1. Update package.json version to: $new_version"
    echo "  2. Reset changelog from origin"
    echo "  3. Publish to NPM with tag: preminor"
    echo "  4. Add NPM dist-tag: nightly"
    echo "  5. Create git tag: v$tag_request"
    echo "  6. Push tag to origin"
    echo ""
    echo "To execute for real, run without --dry-run flag"
    exit 0
end

# Show execution plan
echo ""
echo "📋 Execution Plan:"
echo "  • Version: $current_version → $new_version"
echo "  • Bump type: $bump_type"
echo "  • Git tag: v$tag_request"
echo ""

# Confirm with user
if not continue_or_exit --time-in-prompt --no-empty-accept --prompt-str='Proceed with version bump'
    echo "❌ Aborted by user"
    exit 1
end

echo ""
echo "🚀 Starting version bump and publish process..."

# Function to execute or simulate commands based on dry-run mode
function safe_exec --argument-names description command
    if set -q _flag_dry_run
        echo "🧪 [DRY RUN] Would execute: $command"
        return 0
    else
        echo "🔄 Executing: $description"
        eval $command
        return $status
    end
end

# Step 1: Update package.json version
echo "📝 Updating package.json version..."
if set -q _flag_dry_run
    echo "🧪 [DRY RUN] Would execute: npm pkg set version=$new_version"
else
    npm pkg set version=$new_version
    if test $status -ne 0
        echo "❌ Failed to update package.json"
        exit 1
    end
    echo "✅ Updated package.json to version $new_version"
end

# Step 2: Reset the changelog to the latest version
echo "📄 Resetting changelog from origin..."
if set -q _flag_dry_run
    echo "🧪 [DRY RUN] Would execute: git checkout origin/(current_branch) -- docs/CHANGELOG.md"
else
    git checkout origin/(git branch --show-current 2>/dev/null || echo 'master') -- docs/CHANGELOG.md 
    if test $status -ne 0
        echo "⚠️  Warning: Could not reset changelog from origin"
    end
end

# Step 3: Publish to npm
echo "📦 Publishing to NPM..."
if set -q _flag_dry_run
    echo "🧪 [DRY RUN] Would execute: npm publish --tag preminor"
    echo "🧪 [DRY RUN] Package.json version would be: $new_version"
else
    npm publish --tag preminor
    if test $status -ne 0
        echo "❌ Failed to publish to NPM"
        # Revert package.json changes
        git checkout -- package.json
        exit 1
    end
    echo "✅ Published to NPM with tag 'preminor'"
end

# Step 4: Add nightly dist-tag
echo "🏷️  Adding nightly dist-tag..."
if set -q _flag_dry_run
    echo "🧪 [DRY RUN] Would execute: npm dist-tag add $tag_request nightly"
else
    npm dist-tag add $tag_request nightly
    if test $status -ne 0
        echo "⚠️  Warning: Failed to add nightly dist-tag"
    else
        echo "✅ Added nightly dist-tag"
    end
end

# Step 5: Create and push git tag
echo ""
echo "🏷️  Git tagging process..."
if set -q _flag_dry_run
    echo "🧪 [DRY RUN] Would prompt: Create git tag v$tag_request?"
    echo "🧪 [DRY RUN] Would execute: git tag -a v$tag_request -m '...'"
    echo "🧪 [DRY RUN] Would prompt: Push tag to origin?"
    echo "🧪 [DRY RUN] Would execute: git push origin v$tag_request"
    echo ""
    echo "🧪 [DRY RUN] Final summary would show:"
    echo "  ✅ Version bumped: $current_version → $new_version"
    echo "  ✅ Published to NPM: fish-lsp@$new_version (preminor, nightly)"
    echo "  ✅ Git tag created and pushed: v$tag_request"
else
    if continue_or_exit --time-in-prompt --no-empty-accept --no-retry --prompt-str='Create git tag'
        echo "📝 Creating git tag v$tag_request..."
        git tag -a "v$tag_request" -m "fish-lsp version v$tag_request

https://www.npmjs.com/package/fish-lsp/v/$tag_request

"
        if test $status -ne 0
            echo "❌ Failed to create git tag"
            exit 1
        end
        
        echo "✅ Created git tag v$tag_request"
        git show "v$tag_request"
        
        echo ""
        if continue_or_exit --time-in-prompt --prompt-str='Push tag to origin'
            echo "📤 Pushing tag to origin..."
            git push origin "v$tag_request"
            if test $status -ne 0
                echo "❌ Failed to push tag to origin"
                exit 1
            end
            echo "✅ PUSHED TAG: v$tag_request"
            
            echo ""
            echo "🎉 Release process complete!"
            echo ""
            echo "📋 Summary:"
            echo "  ✅ Version bumped: $current_version → $new_version"
            echo "  ✅ Published to NPM: fish-lsp@$new_version (preminor, nightly)"
            echo "  ✅ Git tag created and pushed: v$tag_request"
            echo ""
            echo "🚀 GitHub Actions will now create the release automatically!"
            echo "   Check: https://github.com/ndonfris/fish-lsp/actions"
        else
            echo "⚠️  Tag created but not pushed to origin"
            echo "   To push manually: git push origin v$tag_request"
        end
    else
        echo "⚠️  Git tag creation skipped"
        echo "✅ NPM package published successfully"
    end
end