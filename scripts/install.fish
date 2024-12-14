#!/usr/bin/env fish

if type -q fish-lsp
    echo "fish-lsp is already installed at: '$(type -ap fish-lsp)'"
    echo "Please uninstall it first before running this script"
    exit 1
end

set -l os_name (uname -s | string lower)
set -l arch (uname -m)

[ $os_name = "darwin" ]; and set os_name "macos"
switch "$arch"
  case "x86_64"
    set arch "x64"
  case "aarch64" "arm64"
    set arch "arm64"
end
# [ $arch = "x86_64" ]; and set arch "x64"
# [ $arch = "aarch64" -o $arch = "arm64" ]; and set arch "arm64"

# Set the installation directory
set -l install_dir "$HOME/.local/bin"
set -l binary_name "fish-lsp"

# Get the latest release URL
set -l repo "ndonfris/fish-lsp"
set -l latest_release_url "https://github.com/$repo/releases/latest/download/fish-lsp-$os_name-$arch"

# Create installation directory if it doesn't exist
mkdir -p $install_dir

echo "Downloading fish-lsp for $os_name-$arch..."
echo "$latest_release_url"
curl -L $latest_release_url -o "$install_dir/$binary_name"

# Make the binary executable
chmod +x "$install_dir/$binary_name"

# Check if installation was successful
if test -x "$install_dir/$binary_name"
    echo "Successfully installed fish-lsp to $install_dir/$binary_name"
    
    # Check if install_dir is in PATH
    if not contains $install_dir $PATH
        echo "Warning: $install_dir is not in your PATH"
        echo "Add the following to your config.fish:"
        echo "    set -gx PATH $install_dir \$PATH"
    end
else
    echo "Installation failed!"
    exit 1
end
