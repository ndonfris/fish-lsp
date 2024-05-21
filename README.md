<h1 style="display: flex; align-items: center; justify-items: center; text-align: center;">
    <img alt="icon.svg" src="https://github.com/ndonfris/fish-lsp.dev/blob/ndonfris-patch-1/coloricon.svg" width="24" height="24"/> FISH-LSP
</h1>

![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/ndonfris/fish-lsp/eslint.yml?branch=master&labelColor=%23181939)
![License](https://img.shields.io/github/license/ndonfris/fish-lsp?&labelColor=%23181939&color=b88af3)
![Github Created At](https://img.shields.io/github/created-at/ndonfris/fish-lsp?logo=%234e6cfa&label=created&labelColor=%23181939&color=%236198f5)

<!-- ### Client Usage -->

![demo.gif](https://github.com/ndonfris/fish-lsp.dev/blob/ndonfris-patch-1/new_output.gif?raw=true)

A [Language Server Protocol (LSP)](https://lsif.dev/) tailored for the [fish shell](https://github.com/microsoft/vscode-languageserver-node/tree/main/server/src/common).
This project aims to enhance the coding experience for fish, by introducing a suite of
intelligent features like auto-completion, scope aware symbol analysis, per-token hover
generation, and [many others](#features).

The overall project goal is to produce [an editor agnostic developer environment](https://en.wikipedia.org/wiki/Language_Server_Protocol) for fish.

 <!-- > [!NOTE] -->
 <!-- > _Please submit other demo's in_ [show & tell](https://github.com/ndonfris/fish-lsp/discussions/categories/show-and-tell) _discussion_ -->

<!-- ### Server Usage -->

  <!-- ```bash -->
  <!--  fish-lsp --help -->
  <!-- ``` -->
  <!---->
  <!-- <details> -->
  <!--   <summary> Generated Output </summary> -->

  <!-- </details> -->

## Features

| Feature | Description | Status |
| --- | --- | --- |
| __Completion__ | Provides completions for commands, variables, and functions | ✅ |
| __Hover__ | Shows documentation for commands, variables, and functions. Has special handlers for `--flag`, `commands`, `functions`, `variables` | ✅ |
| __Signature Help__ | Shows the signature of a command or function | ✖  |
| __Goto Definition__ | Jumps to the definition of a command, variable, or function | ✅ |
| __Find References__ | Shows all references to a command, variable, or function | ✅ |
| __Rename__ | Rename within _matching_ __global__ && __local__ scope | ✅ |
| __Document Symbols__ | Shows all commands, variables, and functions in a document | ✅ |
| __Workspace Symbols__ | Shows all commands, variables, and functions in a workspace | ✅ |
| __Document Formatting__ | Formats a document, _full_ & _selection_ | ✅ |
| __Document Highlight__ / __Semantic Token__ | Highlights all references to a command, variable, or function.  | ✖  |
| __Command Execution__ | Executes a server command from the client | ✖  |
| __Code Action__ | Shows all available code actions | ✖  |
| __Code Lens__ | Shows all available code lenses | ✖  |
| __Logger__ | Logs all server activity | ✅ |
| __Diagnostic__ | Shows all diagnostics | ✖  |
| __Folding Range__ | Toggle ranges to fold text  | ✅ |
| __Telescope Integration__ | Integrates with the telescope.nvim plugin | ✅ |
| __CLI Interactivity__ | Provides a CLI for server interaction. Built by `fish-lsp complete <option>` | ✅ |
| __Client Tree__ | Shows the defined scope as a Tree | ✅ |
| __Indexing__ | Indexes all commands, variables, and functions | ✅ |

## Installation

> __Recommended Dependencies:__ `yarn@1.22.22`, `node@21.7.1`, `fish@3.7.1`

Building from source is __the only currently recommended installation method__, as we improve
other methods of the installation process (Don't use __releases__ or __npm packages__).
Contributions to help enhance installation options are greatly appreciated!

1. Clone the repo

    ```bash
    git clone https://github.com/ndonfris/fish-lsp
    # cd fish-lsp
    ```

1. Install the dependencies & run the setup handler scripts

    ```bash
    yarn install
    ```

1. __Optional:__ Check that the project successfully compiled & linked

    ```bash
    fish-lsp --help # ./bin/fish-lsp --help
    ```

    ![fish-lsp --help](https://github.com/ndonfris/fish-lsp.dev/blob/master/public/help-msg-new.png)

<!-- 1. Setup the project in the [client](https://github.com/ndonfris/fish-lsp/wiki/Client-Configurations) of your choice. _Client's typically only need the keys `command`, -->
<!--    `args/arguments`, and `filetypes` to start a language server._ -->
<!---->
<!--     ```json -->
<!--     { -->
<!--       "fish-lsp": { -->
<!--         "command": "fish-lsp", -->
<!--         "filetypes": ["fish"], -->
<!--         "args": ["start"], -->
<!--         "revealOutputChannelOn": "info", -->
<!--         "initializationOptions": { -->
<!--           "workspaces": { -->
<!--             "paths": { -->
<!--               "defaults": [ -->
<!--                 "$HOME/.config/fish", -->
<!--                 "/usr/share/fish" -->
<!--               ] -->
<!--             } -->
<!--           } -->
<!--         } -->
<!--       } -->
<!--     } -->
<!--     ``` -->
<!---->
<!--     > Neovim client using [coc.nvim](https://github.com/neoclide/coc.nvim) configuartion, located inside [coc-settings.json](https://github.com/neoclide/coc.nvim/wiki/Language-servers#register-custom-language-servers) `"languageserver"` key -->

## Setup

To properly configure [fish-lsp](https://fish-lsp.dev), you need to define a client configuration after
installing the language server. _Client's typically only need the keys `command`,
`args/arguments`, and `filetypes` to start a language server._

### Client Configuration _(Required)_

Theoretically, the language-server should generally be compatible with almost any text-editor or IDE you enjoy using.
Feel free to setup the project in any [fish-lsp-client](https://github.com/ndonfris/fish-lsp/wiki/Client-Configurations) of your choice.

```json
{
  "fish-lsp": {
    "command": "fish-lsp",
    "filetypes": ["fish"],
    "args": ["start"]
  }
}
```

> Neovim client using [coc.nvim](https://github.com/neoclide/coc.nvim) configuartion, located inside [coc-settings.json](https://github.com/neoclide/coc.nvim/wiki/Language-servers#register-custom-language-servers) `"languageserver"` key

### Server Configuration _(Optional)_

Specific functionality for the server can be set independently from the client. This allows for multiple
configurations, to be defined and chosen via specific startup requirements  __(i.e.,__ using the `bind` command
with the _function_ `edit_command_buffer`__).__

#### Environment variables

> Generate by `fish-lsp env --create`

```fish
# fish_lsp_enabled_handlers <ARRAY>
# enables the fish-lsp handlers (options: 'asciiArt', 'formatting', 'logging',
# 'complete', 'hover', 'rename', 'definition', 'references', 'diagnostics',
# 'signatureHelp', 'codeAction', 'index')
set -gx fish_lsp_enabled_handlers

# fish_lsp_disabled_handlers <ARRAY>
# disables the fish-lsp handlers. (options: 'asciiArt', 'formatting', 'logging',
# 'complete', 'hover', 'rename', 'definition', 'references', 'diagnostics',
# 'signatureHelp', 'codeAction', 'index')
set -gx fish_lsp_disabled_handlers

# fish_lsp_commit_characters <ARRAY>
# array of the completion expansion characters. Single letter values only.
# Commit characters are used to select completion items, as shortcuts. (default: [])
set -gx fish_lsp_commit_characters

# fish_lsp_logfile <STRING>
# path to the logs.txt file (default: '~/path/to/fish-lsp/logs.txt')
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
set -gx fish_lsp_diagnostic_disable_error_codes

# fish_lsp_max_background_files <NUMBER>
# maximum number of background files to read into buffer on startup (default: 500)
set -gx fish_lsp_max_background_files
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

<!---
## Why?

  The creation of this project was driven by a vision to bridge the gap in tooling for the
  fish shell, independently separating the shell's community by text-editor/IDE.

### Pros of fish shell

  Fish stands out among shell environments due to its advanced, user-friendly language
  design, which is inherently more structured and intuitive than traditional shells. This modern
  design simplifies script development, enhances readability, and supports robust error handling,
  making it an ideal candidate for a dedicated LSP. By leveraging Fish’s unique features through an LSP,
  developers can harness its full potential, benefiting from intelligent autocomplete, syntax highlighting,
  and real-time feedback that align seamlessly with Fish's syntax. Building an LSP for
  Fish not only taps into these innate capabilities but also enriches the user experience,
  making advanced shell scripting more accessible and productive.

### Simplicity of fish's syntax

  Compared to other programming languages that feature LSP implementations, the syntax and
  language design of fish are notably straightforward. This simplicity theoretically
  facilitates the development of language server features, making them easier to
  conceptualize, document, and test. Additionally, the straightforward nature of fish’s
  design lowers the barrier to entry for understanding the project's core architecture,
  making it less daunting for users to contribute their own feature requests and enhancements.

### Challenges

  Since its inception, __fish-lsp__ has undergone substantial changes, requiring frequent refactoring
  and even the temporary exclusion of certain features to maintain compatibility and performance
  with evolving LSP standards. These modifications have often led to extensive rewrites of
  significant sections throughout the project. As a result, some features are currently on hold until
  they can be seamlessly integrated into the updated framework.

  Your sponsorship and/or contributions are vital to continuing the development and refinement of __fish-lsp__,
  ensuring it remains a valuable tool for the community.
--->

## How does it work?

If you're new to the concept of the [Language Server Protocol (LSP)](https://lsif.dev), this section should be
useful to help you grasp its core purpose and benefits.

> 📸 Check out [this insightful video](https://youtu.be/LaS32vctfOY?si=MISP8tL_HU06-_z-) by TJ DeVries for an introduction to the subject. 📸

The LSP is designed to create a uniform approach for supporting a programming language across
various development tools, moving beyond the confines of specific Text-Editor/IDE ecosystems.
This standardization enhances a language's appeal by allowing developers to maintain consistent
tooling support without needing to switch developer environments.

The core of this system is the interaction between a _'language server'_, which provides
language services, and a _'language client'_, which consumes these services. The protocol
facilitates this interaction, ensuring that any _language client_ can leverage a
well-defined set of features provided by the _server_.

Here is a diagram for a potential fish-lsp process:
 
![graph](https://github.com/ndonfris/fish-lsp.dev/blob/master/public/mermaid-diagram.png?raw=true)

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

