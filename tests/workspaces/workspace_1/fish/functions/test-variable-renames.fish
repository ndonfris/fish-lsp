

function test-variable-renames
    if set -q PATH
        echo '$PATH is set to:'$PATH
    end

    echo $EDITOR
    fish_user_key_bindings
end

