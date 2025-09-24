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

source ./scripts/continue-or-exit.fish
source ./scripts/pretty-print.fish

# Parse command line arguments
set original_argv $argv
set original_argv_count (count $original_argv)

argparse --name='tag-and-publish' \
    h/help \
    d/dry-run \
    c/complete \
    bump \
    bump-pre \
    bump-patch \
    bump-minor \
    use-current \
    archive-sourcemaps \
    build-release-assets \
    reset-changelog \
    -- $argv
or exit 1

if set -q _flag_help
    echo "Usage: tag-and-publish.fish [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -h, --help        Show this help message"
    echo "  -d, --dry-run     Show what would happen without executing"
    echo "  -c, --complete    Show completion commands for this script"
    echo "  --bump            Auto-increment using existing logic (default)"
    echo "  --bump-pre        Increment prerelease number only"
    echo "  --bump-patch      Increment patch version"
    echo "  --bump-minor      Increment minor version"
    echo "  --use-current     Use current package.json version instead of calculating from npm"
    echo "  --archive-sourcemaps Create sourcemaps.tar.gz archive with sourcemap files"
    echo "  --build-release-assets Create release-assets/ folder with assets (no publishing)"
    echo "  --reset-changelog Reset docs/CHANGELOG.md to origin version"
    echo ""
    echo "Examples:"
    echo "  ./scripts/tag-and-publish.fish --bump-pre --dry-run"
    echo "  ./scripts/tag-and-publish.fish --bump-patch"
    echo "  ./scripts/tag-and-publish.fish --bump-minor"
    echo "  ./scripts/tag-and-publish.fish --use-current --dry-run"
    exit 0
end

if set -q _flag_complete
    function show_completion -d 'show the \'complete\' commands for this script'
        set -l script (path resolve -- (status current-filename))
        echo "
            complete --path $script -f
            complete --path $script -s h -l help -d 'Show this help message'
            complete --path $script -s d -l dry-run -d 'Show what would happen without executing'
            complete --path $script -s c -l complete -d 'Show completion commands for this script'
            complete --path $script -l bump -d 'Auto-increment using existing logic (default)'
            complete --path $script -l bump-pre -d 'Increment pre release number only'
            complete --path $script -l bump-patch -d 'Increment patch version'
            complete --path $script -l bump-minor -d 'Increment minor version'
            complete --path $script -l use-current -d 'Use current package.json version instead'
            complete --path $script -l archive-sourcemaps -d 'Create sourcemaps.tar.gz archive'
            complete --path $script -l build-release-assets -d 'Create release-assets folder (no publishing)'
            complete --path $script -l reset-changelog -d 'Reset docs/CHANGELOG.md to origin version'
            # yarn tag-and-publish
            complete -c yarn -n '__fish_seen_subcommand_from tag-and-publish' -f
            complete -c yarn -n '__fish_seen_subcommand_from tag-and-publish' -s h -l help -d 'Show this help message'
            complete -c yarn -n '__fish_seen_subcommand_from tag-and-publish' -s d -l dry-run -d 'Show what would happen without executing'
            complete -c yarn -n '__fish_seen_subcommand_from tag-and-publish' -s c -l complete -d 'Show completion commands for this script'
            complete -c yarn -n '__fish_seen_subcommand_from tag-and-publish' -l bump -d 'Auto-increment using existing logic (default)'
            complete -c yarn -n '__fish_seen_subcommand_from tag-and-publish' -l bump-pre -d 'Increment pre release number only'
            complete -c yarn -n '__fish_seen_subcommand_from tag-and-publish' -l bump-patch -d 'Increment patch version'
            complete -c yarn -n '__fish_seen_subcommand_from tag-and-publish' -l bump-minor -d 'Increment minor version'
            complete -c yarn -n '__fish_seen_subcommand_from tag-and-publish' -l use-current -d 'Use current package.json version instead'
            complete -c yarn -n '__fish_seen_subcommand_from tag-and-publish' -l archive-sourcemaps -d 'Create sourcemaps.tar.gz archive'
            complete -c yarn -n '__fish_seen_subcommand_from tag-and-publish' -l build-release-assets -d 'Create release-assets folder (no publishing)'
            complete -c yarn -n '__fish_seen_subcommand_from tag-and-publish' -l reset-changelog -d 'Reset docs/CHANGELOG.md to origin version'
        " | string trim -l 
    end
    set -l cachedir (__fish_make_cache_dir completions)
    show_completion 
    show_completion | source -
    show_completion > $cachedir/tag-and-publish.fish
    source "$cachedir/tag-and-publish.fish"
    exit
end

# Determine which bump type to use
set -l bump_type auto
if set -q _flag_bump_pre
    set bump_type pre
else if set -q _flag_bump_patch
    set bump_type patch
else if set -q _flag_bump_minor
    set bump_type minor
else if set -q _flag_bump
    set bump_type auto
end

# Function to reset changelog
function reset_changelog
    echo "📄 Resetting docs/CHANGELOG.md from origin..."
    set -l current_branch (git branch --show-current 2>/dev/null || echo 'master')
    git checkout "origin/$current_branch" -- docs/CHANGELOG.md
    if test $status -eq 0
        echo "✅ Reset docs/CHANGELOG.md from origin/$current_branch"
        return 0
    else
        echo "⚠️  Warning: Could not reset changelog from origin/$current_branch"
        return 1
    end
end

# Function to calculate new version
function calculate_new_version --argument-names bump_type
    set -l current_version (npm pkg get version | string unescape)

    switch $bump_type
        case pre
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

        case patch
            # Increment patch version (1.0.11 → 1.0.12)
            set -l parts (string split '.' -- $current_version | string split '-')
            set -l major $parts[1]
            set -l minor $parts[2]
            set -l patch (string match -rg '(\d+)' -- $parts[3])
            set -l new_patch (math $patch + 1)
            echo "$major.$minor.$new_patch"

        case minor
            # Increment minor version (1.0.11 → 1.1.0)
            set -l parts (string split '.' -- $current_version | string split '-')
            set -l major $parts[1]
            set -l minor $parts[2]
            set -l new_minor (math $minor + 1)
            echo "$major.$new_minor.0"

        case auto
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
echo $GREEN"🔍 Calculating new version..."
set -l current_version (npm pkg get version | string unescape)

echo $GREEN"   Current version: $current_version"
set new_version $current_version

if set -q _flag_use_current
    set new_version $current_version
    echo "   Using current package.json version: $new_version"
    echo "   Mode: use-current"
else
    set new_version (calculate_new_version $bump_type)
    if test $status -ne 0
        echo $RED"❌ Failed to calculate new version"
        exit 1
    end
    echo $GREEN"   New version: $new_version"
    echo $GREEN"   Bump type: $bump_type"
end

# Check if version already exists
set -l tag_request "fish-lsp@$new_version"
echo ""
echo $GREEN"🔍 Checking if version exists..."
npm show $tag_request version &>/dev/null

if test $status -eq 0
    echo $RED"❌ Tag $new_version already exists, skipping tag and publish"
    exit 0
end

echo $GREEN"✅ Version $new_version is available"

if set -q _flag_reset_changelog
    reset_changelog
    if test $original_argv_count -eq 1
        exit 0
    end
end

# Build release assets mode (early exit)
if set -q _flag_build_release_assets
    echo ""
    echo $BLUE"📁 Building release assets (no publishing)..."
    
    # Create release-assets directory
    echo "🗂️  Creating release-assets/ directory..."
    if test -d release-assets
        rm -rf release-assets
    end
    mkdir release-assets
    
    if test $status -ne 0
        echo $RED"❌ Failed to create release-assets/ directory"
        exit 1
    end
    echo "✅ Created release-assets/ directory"
    
    # Create sourcemaps archive in release-assets/
    echo "📁 Creating sourcemaps archive..."
    set -l sourcemap_files dist/fish-lsp.map lib/fish-lsp-web.js.map
    set -l existing_files
    
    for file in $sourcemap_files
        if test -f $file
            set -a existing_files $file
        else
            echo "⚠️  Warning: Sourcemap file not found: $file"
        end
    end
    
    if test (count $existing_files) -gt 0
        tar -czf release-assets/sourcemaps.tar.gz $existing_files
        if test $status -eq 0
            echo "✅ Created release-assets/sourcemaps.tar.gz with files: $existing_files"
        else
            echo $RED"❌ Failed to create sourcemaps archive"
            exit 1
        end
    else
        echo "⚠️  Warning: No sourcemap files found, skipping archive creation"
    end
    
    # Copy man page
    echo "📖 Copying man page..."
    if test -f man/fish-lsp.1
        cp man/fish-lsp.1 release-assets/
        if test $status -eq 0
            echo "✅ Copied man/fish-lsp.1 to release-assets/"
        else
            echo $RED"❌ Failed to copy man page"
            exit 1
        end
    else
        echo "⚠️  Warning: Man page not found at man/fish-lsp.1"
    end
    
    # Copy binary
    echo "🔧 Copying binary..."
    if test -f dist/fish-lsp
        cp dist/fish-lsp release-assets/
        if test $status -eq 0
            echo "✅ Copied dist/fish-lsp to release-assets/"
        else
            echo $RED"❌ Failed to copy binary"
            exit 1
        end
    else
        echo "⚠️  Warning: Binary not found at dist/fish-lsp"
    end
    
    # Generate and copy completions
    echo "🐚 Generating and copying completions..."
    if test -f bin/fish-lsp
        ./bin/fish-lsp complete > release-assets/fish-lsp.fish
        if test $status -eq 0
            echo "✅ Generated and copied completions to release-assets/fish-lsp.fish"
        else
            echo $RED"❌ Failed to generate completions"
            exit 1
        end
    else
        echo "⚠️  Warning: fish-lsp binary not found at bin/fish-lsp"
    end
    
    # Create npm package
    echo "📦 Creating npm package..."
    npm pack
    if test $status -eq 0
        # Find and move the .tgz file
        set -l tgz_file (command ls -t *.tgz 2>/dev/null | head -n1)
        if test -n "$tgz_file"
            mv "$tgz_file" release-assets/
            if test $status -eq 0
                echo "✅ Created and moved $tgz_file to release-assets/"
            else
                echo $RED"❌ Failed to move $tgz_file to release-assets/"
                exit 1
            end
        else
            echo $RED"❌ No .tgz file found after npm pack"
            exit 1
        end
    else
        echo $RED"❌ Failed to run npm pack"
        exit 1
    end
    
    echo ""
    echo $GREEN"🎉 Release assets built successfully!"
    echo $GREEN"📁 Contents of release-assets/:"
    ls -la release-assets/
    
    # Reset changelog if flag is provided
    if set -q _flag_reset_changelog
        echo $BLUE"resetting the docs/CHANGELOG.md as requested..."$NORMAL
        reset_changelog
    end
    
    echo ""
    echo $GREEN"Ready for release! 🚀"
    exit 0
end

# Dry run mode
if set -q _flag_dry_run
    echo $BLUE""
    echo $BLUE"🧪 DRY RUN MODE - No changes will be made"
    echo $BLUE""
    echo $BLUE"Would perform the following actions:"
    echo $BLUE"  1. Update package.json version to: $new_version"
    echo $BLUE"  2. Reset changelog from origin"
    echo $BLUE"  3. Publish to NPM with tag: preminor"
    echo $BLUE"  4. Add NPM dist-tag: nightly"
    if set -q _flag_archive_sourcemaps
        echo $BLUE"  5. Create sourcemaps.tar.gz archive"
        echo $BLUE"  6. Create git tag: v$new_version"
        echo $BLUE"  7. Push tag to origin"
    else
        echo $BLUE"  5. Create git tag: v$new_version"
        echo $BLUE"  6. Push tag to origin"
    end
    echo $BLUE""
    echo $BLUE"To execute for real, run without --dry-run flag"$NORMAL
    exit 0
end

# Show execution plan
echo ""
echo "📋 Execution Plan:"
echo "  • Version: $current_version → $new_version"
echo "  • Bump type: $bump_type"
echo "  • Git tag: v$new_version"
echo ""

# Confirm with user
if not continue-or-exit --time-in-prompt --no-empty-accept --prompt-str='Proceed with version bump'
    echo $RED"❌ Aborted by user"
    exit 1
end

echo ""
echo $BLUE"🚀 Starting version bump and publish process..."

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
echo $GREEN"📄 Resetting $(icon_file)./docs/CHANGELOG.md from origin..."
if set -q _flag_dry_run
    echo $BLUE"🧪 [DRY RUN] Would execute: git checkout origin/(current_branch) -- docs/CHANGELOG.md"
else
    git checkout origin/(git branch --show-current 2>/dev/null || echo 'master') -- docs/CHANGELOG.md
    if test $status -ne 0
        echo $YELLOW"⚠️  Warning: Could not reset changelog from origin"
    end
end

# Step 3: Publish to npm
echo "📦 Publishing to NPM..."
if set -q _flag_dry_run
    echo $BLUE"🧪 [DRY RUN] Would execute: npm publish --tag preminor"
    echo $BLUE"🧪 [DRY RUN] Package.json version would be: $new_version"
else
    npm publish --tag preminor
    if test $status -ne 0
        echo $RED"❌ Failed to publish to NPM"
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

# Step 5: Create sourcemaps archive (if requested)
if set -q _flag_archive_sourcemaps
    echo "📁 Creating sourcemaps archive..."
    if set -q _flag_dry_run
        echo "🧪 [DRY RUN] Would execute: tar -czf sourcemaps.tar.gz dist/fish-lsp.map lib/fish-lsp-web.js.map"
    else
        # Check if the sourcemap files exist
        set -l sourcemap_files dist/fish-lsp.map lib/fish-lsp-web.js.map
        set -l existing_files
        
        for file in $sourcemap_files
            if test -f $file
                set -a existing_files $file
            else
                echo "⚠️  Warning: Sourcemap file not found: $file"
            end
        end
        
        if test (count $existing_files) -gt 0
            tar -czf sourcemaps.tar.gz $existing_files
            if test $status -eq 0
                echo "✅ Created sourcemaps.tar.gz with files: $existing_files"
            else
                echo "❌ Failed to create sourcemaps archive"
            end
        else
            echo "⚠️  Warning: No sourcemap files found, skipping archive creation"
        end
    end
end

# Step 6: Create and push git tag
echo ""
echo "🏷️  Git tagging process..."
if set -q _flag_dry_run
    echo $BLUE"🧪 [DRY RUN] Would prompt: Create git tag v$new_version?"
    echo $BLUE"🧪 [DRY RUN] Would execute: git tag -a v$new_version -m '...'"
    echo $BLUE"🧪 [DRY RUN] Would prompt: Push tag to origin?"
    echo $BLUE"🧪 [DRY RUN] Would execute: git push origin v$new_version"
    echo ""
    echo $BLUE"🧪 [DRY RUN] Final summary would show:"
    echo $BLUE"  ✅ Version bumped: $current_version → $new_version"
    echo $BLUE"  ✅ Published to NPM: fish-lsp@$new_version (preminor, nightly)"
    if set -q _flag_archive_sourcemaps
        echo $BLUE"  ✅ Created sourcemaps.tar.gz archive"
    end
    echo $BLUE"  ✅ Git tag created and pushed: v$new_version"
else
    if continue_or_exit --time-in-prompt --no-empty-accept --no-retry --prompt-str='Create git tag'
        echo $GREEN"📝 Creating git tag v$new_version..."
        git tag -a "v$new_version" -m "fish-lsp version v$new_version

https://www.npmjs.com/package/fish-lsp/v/$new_version

"
        if test $status -ne 0
            echo $RED"❌ Failed to create git tag"
            exit 1
        end

        echo $GREEN"✅ Created git tag v$new_version"
        git show "v$new_version"

        echo ""
        if continue_or_exit --time-in-prompt --prompt-str='Push tag to origin'
            echo $BLUE"📤 Pushing tag to origin..."
            git push origin "v$new_version"
            if test $status -ne 0
                echo $RED"❌ Failed to push tag to origin"
                exit 1
            end
            echo $BLUE"✅ PUSHED TAG: v$new_version"

            echo $BLUE""
            echo $BLUE"🎉 Release process complete!"
            echo $BLUE""
            echo $BLUE"📋 Summary:"
            echo $BLUE"  ✅ Version bumped: $current_version → $new_version"
            echo $BLUE"  ✅ Published to NPM: fish-lsp@$new_version (preminor, nightly)"
            if set -q _flag_archive_sourcemaps
                echo $BLUE"  ✅ Created sourcemaps.tar.gz archive"
            end
            echo $BLUE"  ✅ Git tag created and pushed: v$new_version"
            echo $BLUE""
            echo $BLUE"🚀 GitHub Actions will now create the release automatically!"
            echo $BLUE"   Check: https://github.com/ndonfris/fish-lsp/actions"
        else
            echo $RED"⚠️  Tag created but not pushed to origin"
            echo $RED"   To push manually: git push origin v$new_version"
        end
    else
        echo $BLUE"⚠️  Git tag creation skipped"
        echo $BLUE"✅ NPM package published successfully"
    end
end
