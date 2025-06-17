# ┌───────────┐
# │ git utils │
# └───────────┘
function git_branch_exists --description 'takes array of branch names, prints first one that exists'
    argparse --ignore-unknown h/help fallback= -- $argv
    or return

    set -ql _flag_help
    and begin
        echo "Usage: git_branch_exists [OPTIONS] <branch1> <branch2> ..."
        echo "Check if any of the specified branches exist in the current git repository."
        echo ""
        echo "Options:"
        echo "  -h, --help       Show this help message and exit"
        echo "  --fallback=      Specify a fallback branch to return if none of the branches exist"
        return 0
    end

    # Skip if not in a git directory
    git rev-parse --git-dir &>/dev/null || return
    for branch in $argv
        if git rev-parse --verify $branch &>/dev/null
            echo $branch
            return
        end
    end
    # non of the branches found existed, so echo the fallback
    if set -lq _flag_fallback
        echo $_flag_fallback
        return
    end
    return 1
end

function git_push_origin_current_branch
    set current_branch (git rev-parse --abbrev-ref HEAD)
    string join ' ' -- git push origin $current_branch
end

function git_push_origin_current_branch_with_upstream
    set current_branch (git rev-parse --abbrev-ref HEAD)
    string join ' ' -- git push -u origin $current_branch
end

function git_pull_origin_current_branch
    set current_branch (git rev-parse --abbrev-ref HEAD)
    string join ' ' -- git pull origin $current_branch
end

function git_push_origin_master_branch
    set -l master_branch "$(git_branch_exists master main trunk --fallback master)"
    string join ' ' -- git push origin $master_branch
end

function git_push_origin_master_branch_with_upstream
    set -l master_branch "$(git_branch_exists master main trunk --fallback master)"
    string join ' ' -- git push -u origin $master_branch
end

function git_pull_origin_master_branch
    set -l master_branch "$(git_branch_exists master main trunk --fallback master)"
    string join ' ' -- git pull origin $master_branch
end

function gh_browse_current_branch
    set current_branch (git rev-parse --abbrev-ref HEAD)
    string join ' ' -- gh browse $current_branch
end

function gh_browse_master_branch
    set -l master_branch "$(git_branch_exists master main trunk --fallback master)"
    string join ' ' -- gh browse $master_branch
end

function asdf
  set -q PATH
  and return 1    # Success path terminates
  or return 0     # Failure path terminates

  echo hi # Correctly detected as unreachable!
end

#########################################################################################
#########################################################################################
#########################################################################################


# ┌─────┐
# │ git │
# └─────┘
abbr -a g git

# commit
abbr -a gc git commit
abbr -a gcam --set-cursor=% git commit -a -m "%"
abbr -a gcane git commit --amend --no-edit

# push
abbr -a gpoc --function git_push_origin_current_branch
abbr -a gpocu --function git_push_origin_current_branch_with_upstream
abbr -a gpm --function git_push_origin_master_branch
abbr -a gpmu --function git_push_origin_master_branch_with_upstream

# pull
abbr -a gploc --function git_pull_origin_current_branch
abbr -a gplm --function git_pull_origin_master_branch

# browse
abbr -a gbc --function gh_browse_current_branch
abbr -a gbm --function gh_browse_master_branch


# ┌──────┐
# │ date │
# └──────┘
# with spaces
abbr -a --command date -- yesterday --date=\'1 day ago\' \'+%Y-%m-%d %H:%M:%S\'
abbr -a --command date -- now +\'%Y-%m-%d %H:%M:%S\'
abbr -a --command date -- tomorrow --date=\'1 day ago\' \'+%Y-%m-%d %H:%M:%S\'
abbr -a --command date -- today +\'%Y-%m-%d\'
# with underscores
abbr -a --command date -- yesterday_ --date=\'1 day ago\' \'+%Y-%m-%d_%H:%M:%S\'
abbr -a --command date -- now_ +\'%Y-%m-%d_%H:%M:%S\'
abbr -a --command date -- tomorrow_ --date=\'1 day ago\' \'+%Y-%m-%d_%H:%M:%S\'

# ┌──────┐
# │ fish │
# └──────┘
abbr -a fcc fish_clipboard_copy
abbr -a fcp fish_clipboard_paste
