<h1 align="center">
    <div align="center">
        <a href="https://fish-lsp.dev">
            <image src="https://raw.githubusercontent.com/ndonfris/fish-lsp.dev/31d3d587ebd00f76ababcc98ed21b5109637e318/public/favicon-centered-bluee.svg" alt="fish-lsp" style="position: flex; text-align: center;" height="23rem"> fish-lsp
        </a>
        <div align="center">
            <img src="https://img.shields.io/github/actions/workflow/status/ndonfris/fish-lsp/eslint.yml?branch=master&labelColor=%23181939" alt="GitHub Actions Workflow Status">
            <img src="https://img.shields.io/github/license/ndonfris/fish-lsp?&labelColor=%23181939&color=b88af3" alt="License">
            <img src="https://img.shields.io/github/created-at/ndonfris/fish-lsp?logo=%234e6cfa&label=created&labelColor=%23181939&color=%236198f5" alt="Github Created At">
        </div>
    </div>
</h1>

![demo.gif](https://github.com/ndonfris/fish-lsp.dev/blob/ndonfris-patch-1/new_output.gif?raw=true)

<!-- A [Language Server Protocol (LSP)](https://lsif.dev/) tailored for the [fish shell](https://github.com/microsoft/vscode-languageserver-node/tree/main/server/src/common). -->
Introducing the [fish-lsp](https://fish-lsp.dev), a [Language Server Protocol (LSP)](https://lsif.dev/) implementation for the [fish shell language](https://fishshell.com).

<!-- The overall project goal is to produce [an editor agnostic developer environment](https://en.wikipedia.org/wiki/Language_Server_Protocol), while simultaneously -->
<!-- introducing an extensive suite of intelligent text editing [features](#features). -->
<!---->
## Why? 🐟

- 🦈 __Efficiency__: enhances the shell scripting experience with an extensive suite of intelligent text-editing [features](#features)

- 🐡 __Flexibility__: allows for a highly customizable [configuration](#server-configuration-optional)

- 🐚 __Guidance__: [friendly hints](https://github.com/ndonfris/fish-lsp/?tab=readme-ov-file#) and [documentation](#installation) to comfortably explore command line tooling

- 🐬 __Community__: improved by a [vibrant user base](#contributors), with [supportive and insightful feedback](https://github.com/ndonfris/fish-lsp/discussions)

- 🐙 __Compatibility__: integrates with a wide variety of [tooling and language clients](#client-configuration-required)

- 🌊 __Reliability__: produces an [editor agnostic developer environment](https://en.wikipedia.org/wiki/Language_Server_Protocol),
     ensuring __all__ fish user's have access to a consistent set of features

## Features

| Feature | Description | Status |
| --- | --- | --- |
| __Completion__ | Provides completions for commands, variables, and functions | ✅ |
| __Hover__ | Shows documentation for commands, variables, and functions. Has special handlers for `--flag`, `commands`, `functions`, `variables` | ✅ |
| __Signature Help__ | Shows the signature of a command or function | ✅  |
| __Goto Definition__ | Jumps to the definition of a command, variable, or function | ✅ |
| __Find References__ | Shows all references to a command, variable, or function | ✅ |
| __Rename__ | Rename within _matching_ __global__ && __local__ scope | ✅ |
| __Document Symbols__ | Shows all commands, variables, and functions in a document | ✅ |
| __Workspace Symbols__ | Shows all commands, variables, and functions in a workspace | ✅ |
| __Document Formatting__ | Formats a document, _full_ & _selection_ | ✅ |
| __Document Highlight__ / __Semantic Token__ | Highlights all references to a command, variable, or function.  | ✅  |
| __Command Execution__ | Executes a server command from the client | ✅ |
| __Code Action__ | Shows all available code actions | ✖  |
| __Code Lens__ | Shows all available code lenses | ✖  |
| __Logger__ | Logs all server activity | ✅ |
| __Diagnostic__ | Shows all diagnostics | ✅ |
| __Folding Range__ | Toggle ranges to fold text  | ✅ |
| __Telescope Integration__ | Integrates with the telescope.nvim plugin | ✅ |
| __CLI Interactivity__ | Provides a CLI for server interaction. <br/>Built by `fish-lsp complete <option>` | ✅ |
| __Client Tree__ | Shows the defined scope as a Tree | ✅ |
| __Indexing__ | Indexes all commands, variables, and functions | ✅ |

<!-- ## Challenges -->
<!---->
<!-- Since its inception, __fish-lsp__ has undergone substantial changes to maintain compatibility -->
<!-- and performance with the continuously evolving [LSP standards](https://github.com/Microsoft/vscode-languageserver-node). As a result, some features are still being -->
<!-- refined or have been temporarily excluded while their internal data-structures are being reworked. -->
<!---->
<!-- __Please__ consider [sponsoring](https://github.com/sponsors/ndonfris) and/or [contributing](./docs/ROADMAP.md) to the project. Supporting -->
<!-- the project immensely speeds up the release schedule, and significantly -->
<!-- improves the possibilities capable from future complex __fish-lsp__ features. -->
<!---->
<!-- If you'd like to contribute, please check out the [contributing guidelines](./docs/CONTRIBUTING.md). Every bit helps, whether it's code, documentation, or just spreading the word! -->

## Installation

Some language clients might support downloading the fish-lsp directly from within the client, but for the most part, you'll typically be required to install the language server manually.

Below are some common methods to install the language server

#### Build from Source (Recommended)

> Recommended Dependencies: `yarn@1.22.22` `node@22.12.0` `fish@3.7.1`

```bash
# Clone the repository
git clone https://github.com/ndonfris/fish-lsp
cd fish-lsp

# Install dependencies and build
yarn install

# verify the installation succeeded
fish-lsp info  # ./bin/fish-lsp info
```

#### Download a Standalone Executable

Available on the [releases page](https://github.com/ndonfris/fish-lsp/releases) or using the installation script below:

```bash
curl -sL https://raw.githubusercontent.com/ndonfris/fish-lsp/master/scripts/install.fish | fish
```

The standalone executables are built using [pkg](https://www.npmjs.com/package/@yao-pkg/pkg), and don't require `node` or `yarn` to be installed.

#### Using a Package Managers

Currently, it is __not recommended__ to use package managers for installation.

However, the following package managers are supported:

```bash
# Using npm
npm install -g fish-lsp

# Using yarn
yarn global add fish-lsp

# Using pnpm
pnpm install -g fish-lsp

# Using nix
nix-shell -p fish-lsp
```

### Verifying Installation

After installation, verify that `fish-lsp` is working correctly:

```bash
fish-lsp --help
```

![fish-lsp --help](https://github.com/ndonfris/fish-lsp.dev/blob/master/public/help-msg-new.png)

## Setup

To properly configure [fish-lsp](https://fish-lsp.dev), you need to define a client configuration after installing the language server.

> To start a language server, _client's typically only need to configure the keys `command`, `arguments`, and `filetypes`_
>
> This should be straightforward to translate from the shell command `fish-lsp start` for `fish` files

### Client Configuration _(Required)_

Theoretically, the language-server should generally be compatible with almost any text-editor or IDE you prefer using.

Below are some examples of how to configure the language server in various clients:

<details>
  <summary><b>neovim (v0.8)</b></summary>

  Full table of options available in the [neovim documentation](https://neovim.io/doc/user/lsp.html)

  ```lua
  vim.api.nvim_create_autocmd('FileType', {
    pattern = 'fish',
    callback = function()
      vim.lsp.start({
        name = 'fish-lsp',
        cmd = { 'fish-lsp', 'start' },
        cmd_env = { fish_lsp_show_client_popups = false },
      })
    end,
  })
  ```

</details>
<details>
  <summary><b>nvim-lspconfig</b><a name="nvim-lspconfig"></a></summary>

  Configuration provided by [nvim-lspconfig](https://github.com/neovim/nvim-lspconfig/blob/master/doc/configs.md#fish_lsp)

```lua
local util = require 'lspconfig.util'

return {
  default_config = {
    cmd = { 'fish-lsp', 'start' },
    cmd_env = { fish_lsp_show_client_popups = false },
    filetypes = { 'fish' },
    root_dir = util.find_git_ancestor,
    single_file_support = true,
  },
}
```

</details>
<details>
  <summary><b>coc.nvim</b></summary>

  [Neovim](https://neovim.io) client using [coc.nvim](https://github.com/neoclide/coc.nvim) configuration, located inside [coc-settings.json](https://github.com/neoclide/coc.nvim/wiki/Language-servers#register-custom-language-servers) `"languageserver"` key

  ```json
  {
    "fish-lsp": {
      "command": "fish-lsp",
      "filetypes": ["fish"],
      "args": ["start"]
    }
  }
  ```

</details>
<details>
  <summary><b>mason.nvim</b></summary>

  ```lua
  require('mason').setup {
    registries = {
      "github:bnwa/mason-registry",
      "github:mason-org/mason-registry",
    }
  }
  -- `:MasonUpdate`
  ```

  Once installed, you can configure the language server directly similar to the [nvim-lspconfig](#nvim-lspconfig) example

  ```lua
  -- once installed
  vim.lsp.start {
    cmd = { 'fish-language-server', 'start' }
    name = 'fish-language-server',
    root_dir = vim.fs.root(0, { 'config.fish' })
  }
  ```

  > for more info, please see [@bnwa/mason-registry](https://github.com/bnwa/mason-registry)
</details>
<details>
  <summary><b>YouCompleteMe</b></summary>

  YouCompleteMe configuration for vimscript lsp client

  ```vim
  let g:ycm_language_server =
            \ [
            \   {
            \       'name': 'fish',
            \       'cmdline': [ 'fish-lsp', 'start' ],
            \       'filetypes': [ 'fish' ],
            \   }
            \ ]
  ```

</details>
<details>
  <summary><b>helix</b></summary>

  In config file `~/.config/helix/languages.toml`

  ```toml
[[language]]
name = "fish"
language-servers = [ "fish-lsp" ]

[language-server.fish-lsp]
command = "fish-lsp"
args= ["start"]
  ```

</details>
<details>
  <summary><b>kakoune-lsp</b></summary>

  ```kak
  hook global BufSetOption filetype=(?:fish) %{
    set-option buffer lsp_servers %{
      [fish-lsp]
      args = ["start"]
    }
  }
 
  ```

</details>
<details>
  <summary><b>emacs (using eglot)</b></summary>
<!---->
<!--   ```elisp -->
<!-- (unless (package-installed-p 'fish-mode) -->
<!-- (package-install 'fish-mode)) -->
<!---->
<!-- ;; Load eglot (built into Emacs 29+) -->
<!-- (require 'eglot) -->
<!---->
<!-- ;; Register fish-lsp with eglot -->
<!-- (add-to-list 'eglot-server-programs -->
<!--              '(fish-mode . ("fish-lsp" "start"))) -->
<!---->
<!-- ;; Automatically start eglot when opening fish files -->
<!-- (add-hook 'fish-mode-hook 'eglot-ensure) -->
<!--   ``` -->

  ```elisp
  ;; Configure Eglot for fish files
  (use-package eglot
    :ensure t
    :config
    ;; Register fish-lsp with eglot
    (add-to-list 'eglot-server-programs
                 '(fish-mode . ("fish-lsp" "start")))
    
    ;; Automatically start eglot when opening fish files
    (add-hook 'fish-mode-hook 'eglot-ensure))
  ```

<!--   ```elisp -->
<!-- ;; Ensure necessary packages are installed -->
<!-- (require 'lsp-mode) -->
<!-- (require 'fish-mode) -->
<!---->
<!-- ;; Register fish-lsp with lsp-mode -->
<!-- (add-to-list 'lsp-language-id-configuration '(fish-mode . "fish")) -->
<!---->
<!-- (lsp-register-client -->
<!--  (make-lsp-client -->
<!--   :new-connection (lsp-stdio-connection '("fish-lsp" "start")) -->
<!--   :activation-fn (lsp-activate-on "fish") -->
<!--   :server-id 'fish-lsp -->
<!--   :major-modes '(fish-mode))) -->
<!---->
<!-- ;; Automatically start LSP when opening fish files -->
<!-- (add-hook 'fish-mode-hook #'lsp) -->
<!---->
<!-- ;; Optional: Configure some LSP mode settings -->
<!-- (setq lsp-enable-snippet t -->
<!--       lsp-enable-completion-at-point t) -->
<!--   ``` -->
</details>

Feel free to setup the project in any [fish-lsp-client](https://github.com/ndonfris/fish-lsp/wiki/Client-Configurations) of your choice, or [submit a PR](https://github.com/ndonfris/fish-lsp-language-clients/pulls) for new configurations.

### Server Configuration _(Optional)_

Specific functionality for the server can be set independently from the client. This allows for multiple
configurations, to be defined and chosen via specific startup requirements  __(i.e.,__ using the `bind` command
with the _function_ `edit_command_buffer`__).__

<!-- <details> -->
<!--   <summary>edit_command_buffer wrapper</summary> -->
<!---->
<!--   ```fish -->
<!--   function edit_command_buffer_wrapper -->
<!--     set -lx  fish_lsp_diagnostic_disable_error_codes 1001 1002 1003 1004 2001 2002 2003 3001 3002 3003  -->
<!--     set -lx fish_lsp_show_client_popups false -->
<!--     edit_command_buffer -->
<!--   end -->
<!--   bind \ee edit_command_buffer_wrapper -->
<!--   ``` -->
<!---->
<!-- </details> -->

#### Environment variables

> Generated by `fish-lsp env --create`

```fish
# fish_lsp_enabled_handlers <ARRAY>
# enables the fish-lsp handlers (options: 'formatting', 'complete', 'hover', 'rename', 'definition', 'references', 'diagnostics', 'signatureHelp', 'codeAction', 'index')
set -gx fish_lsp_enabled_handlers

# fish_lsp_disabled_handlers <ARRAY>
# disables the fish-lsp handlers (options: 'formatting', 'complete', 'hover', 'rename', 'definition', 'references', 'diagnostics', 'signatureHelp', 'codeAction', 'index')
set -gx fish_lsp_disabled_handlers

# fish_lsp_commit_characters <ARRAY>
# array of the completion expansion characters. Single letter values only.
# Commit characters are used to select completion items, as shortcuts. (default: [])
set -gx fish_lsp_commit_characters

# fish_lsp_logfile <STRING>
# path to the logs.txt file (default: '')
# example locations could be: '~/path/to/fish-lsp/logs.txt' or '/tmp/fish_lsp.logs'
set -gx fish_lsp_logfile

# fish_lsp_format_tabsize <NUMBER>
# amount of spaces in a tab character for the formatter provider (default: 4)
set -gx fish_lsp_format_tabsize

# fish_lsp_format_switch_case <BOOLEAN>
# keep case statements left aligned with switch block. (default: false)
set -gx fish_lsp_format_switch_case

# fish_lsp_all_indexed_paths <ARRAY>
# fish file paths/workspaces to include as workspaces (default: ['/usr/share/fish', "$HOME/.config/fish"])
set -gx fish_lsp_all_indexed_paths

# fish_lsp_modifiable_paths <ARRAY>
# fish file paths/workspaces that can be renamed by the user. (default: ["$HOME/.config/fish"])
set -gx fish_lsp_modifiable_paths

# fish_lsp_diagnostic_disable_error_codes <ARRAY>
# disable diagnostics for matching error codes (default: [])
# (options: 1001, 1002, 1003, 1004, 2001, 2002, 2003, 3001, 3002, 3003)
set -gx fish_lsp_diagnostic_disable_error_codes

# fish_lsp_max_background_files <NUMBER>
# maximum number of background files to read into buffer on startup (default: 1000)
set -gx fish_lsp_max_background_files

# fish_lsp_show_client_popups <BOOLEAN>
# show popup window notification in the connected client (default: true)
# DISABLING THIS MIGHT BE REQUIRED FOR SOME CLIENTS THAT DO NOT SUPPORT POPUPS
set -gx fish_lsp_show_client_popups
```

#### Command Flags

Both the flags `--enable` and `--disable` are provided on the `fish-lsp start`
subcommand. __By default, all handlers will be enabled__.

```fish
# displays what handlers are enabled. Removing the dump flag will run the server.
fish-lsp start --disable complete signature --dump 
```

#### Further Server Configuration

Any [flags](#command-flags) will overwrite their corresponding [environment variables](#environment-variables), if both are
seen for the `fish-lsp` process. For this reason, it is encouraged to wrap any
non-standard behavior of the `fish-lsp` in [functions](https://fishshell.com/docs/current/language.html#functions) or [aliases](https://fishshell.com/docs/current/language.html#defining-aliases).

Due to the vast possibilities this project aims to support in the fish shell,
[sharing useful configurations is highly encouraged](https://github.com/ndonfris/fish-lsp/discussions).

## How does it work?

If you're new to the concept of the [Language Server Protocol (LSP)](https://lsif.dev), this section should be
useful to help you grasp its core purpose and benefits.

> 📸 Check out [this insightful video](https://youtu.be/LaS32vctfOY?si=MISP8tL_HU06-_z-) by TJ DeVries for an introduction to the subject.

The LSP is designed to create a uniform approach for supporting a programming language across
various development tools, moving beyond the confines of specific Text-Editor/IDE ecosystems.
This standardization enhances a language's appeal by allowing developers to maintain consistent
tooling support without needing to switch developer environments.

The core of this system is the interaction between a _'language server'_, which provides
language services, and a _'language client'_, which consumes these services. The protocol
facilitates this interaction, ensuring that any _language client_ can leverage a
well-defined set of features provided by the _server_.

<details>

<summary><b>Show</b> a diagram to <ins><i>visualize</i></ins> a hypothetical <code>fish-lsp</code> process</summary>

![graph](https://github.com/ndonfris/fish-lsp.dev/blob/master/public/mermaid-diagram.png?raw=true)

</details>

<!-- ## Challenges -->
<!-- ![Static Badge](https://img.shields.io/badge/REQUIRED-8a2Be2?style=plastic) -->
<!---->
<!-- Since its inception, __fish-lsp__ has undergone substantial changes, requiring frequent refactoring -->
<!-- and even the temporary exclusion of certain features to maintain compatibility and performance -->
<!-- with the ever evolving [LSP standards](https://github.com/Microsoft/vscode-languageserver-node). These modifications have often led to extensive rewrites of -->
<!-- significant sections throughout the project. As a result, some features are currently on hold until -->
<!-- they can be seamlessly integrated into the updated framework. -->
<!---->
<!-- > [!NOTE] -->
<!-- > __Your sponsorship and/or contributions are vital to continuing the development and refinement of [fish-lsp](https://fish-lsp.dev), -->
<!-- > ensuring it remains a valuable tool for the community.__ -->

## Additional Resources

- [Contributing](./docs/CONTRIBUTING.md) - documentation describing how to contribute to the fish-lsp project.
- [Roadmap](./docs/ROADMAP.md) - goals for future project releases.
- [Wiki](https://github.com/ndonfris/fish-lsp/wiki) - further documentation and knowledge relevant to the project
- [Discussions](https://github.com/ndonfris/fish-lsp/discussions) - interact with maintainers
- [Site](https://fish-lsp.dev/) - website homepage
- [Client Examples](https://github.com/ndonfris/fish-lsp/wiki/Client-Configurations) - testable language client configurations
- [Sources](https://github.com/ndonfris/fish-lsp/wiki/Sources) - major influences for the project

## Contributors

Special thanks to anyone who contributed to the project!
Contributions of any kind are welcome!

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/ndonfris"><img src="https://avatars.githubusercontent.com/u/49458459?v=4?s=50" width="50px;" alt="nick"/><br /><sub><b>nick</b></sub></a><br /><a href="https://github.com/ndonfris/fish-lsp/commits?author=ndonfris" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/mimikun"><img src="https://avatars.githubusercontent.com/u/13450321?v=4?s=50" width="50px;" alt="mimikun"/><br /><sub><b>mimikun</b></sub></a><br /><a href="https://github.com/ndonfris/fish-lsp/commits?author=mimikun" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/jpaju"><img src="https://avatars.githubusercontent.com/u/36770267?v=4?s=50" width="50px;" alt="Jaakko Paju"/><br /><sub><b>Jaakko Paju</b></sub></a><br /><a href="https://github.com/ndonfris/fish-lsp/commits?author=jpaju" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/shaleh"><img src="https://avatars.githubusercontent.com/u/1377996?v=4?s=50" width="50px;" alt="Sean Perry"/><br /><sub><b>Sean Perry</b></sub></a><br /><a href="https://github.com/ndonfris/fish-lsp/commits?author=shaleh" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://mastodon.online/@cova"><img src="https://avatars.githubusercontent.com/u/385249?v=4?s=50" width="50px;" alt="Fabio Coatti"/><br /><sub><b>Fabio Coatti</b></sub></a><br /><a href="https://github.com/ndonfris/fish-lsp/commits?author=cova-fe" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/PeterCardenas"><img src="https://avatars.githubusercontent.com/u/16930781?v=4?s=50" width="50px;" alt="Peter Cardenas"/><br /><sub><b>Peter Cardenas</b></sub></a><br /><a href="https://github.com/ndonfris/fish-lsp/commits?author=PeterCardenas" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/petertriho"><img src="https://avatars.githubusercontent.com/u/7420227?v=4?s=50" width="50px;" alt="Peter Tri Ho"/><br /><sub><b>Peter Tri Ho</b></sub></a><br /><a href="https://github.com/ndonfris/fish-lsp/commits?author=petertriho" title="Code">💻</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/bnwa"><img src="https://avatars.githubusercontent.com/u/74591246?v=4?s=50" width="50px;" alt="bnwa"/><br /><sub><b>bnwa</b></sub></a><br /><a href="https://github.com/ndonfris/fish-lsp/commits?author=bnwa" title="Code">💻</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

This project follows the [all-contributors](https://allcontributors.org) specification.

## License

[MIT](https://github.com/ndonfris/fish-lsp/blob/master/LICENSE)