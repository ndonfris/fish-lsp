function do-something-per-os

    if os-name --is-mac
        echo "Doing something for macOS"
        # Add macOS specific commands here
    else if os-name --is-linux
        echo "Doing something for Linux"
        # Add Linux specific commands here
    else if os-name --is-unix
        echo "Doing something for Unix-like systems"
        # Add Unix-like specific commands here
    else if os-name --is-windows
        echo "Doing something for Windows"
        # Add Windows specific commands here
    else
        echo "Unknown OS"
    end

    echo "is-mac: " (os-name --is-mac)
    echo "is-linux: " (os-name --is-linux)
    echo "is-unix: " (os-name --is-unix)
    echo "is-windows: " (os-name --is-windows)
    echo "is-win: " (os-name --is-win)

    echo "OS Name: " (os-name --set --local; echo $OS_NAME)

    function is-good-os
        if os-name --is-mac
            return 0
        else if os-name --is-linux
            return 0
        else if os-name --is-unix
            return 0
        else if os-name --is-windows
            return 1
        else
            return 1
        end
    end

    if is-good-os
        echo "This is a good OS!"
    else
        echo "This OS is not recommended."
    end
end
