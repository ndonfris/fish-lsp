# fish-lsp

A __feature-rich__, __extensible__, and __blazingly fast__ [language-server](https://github.com/microsoft/vscode-languageserver-node/tree/main/server/src/common) for the [fish-shell](https://fishshell.com/). 
Uses [tree-sitter](https://tree-sitter.github.io/tree-sitter/), [tree-sitter-fish](https://github.com/ram02z/tree-sitter-fish), [yarn](https://yarnpkg.com/) and [typescript](https://www.typescriptlang.org/). 
Implements both standard & non-standard features from the [language-server-protocol](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#headerPart), 
to be connected to a language-client ([neovim](https://neovim.io/),[coc.nvim](https://github.com/neoclide/coc.nvim), [vscode](https://code.visualstudio.com/), [etc.](https://github.com/ndonfris/fish-lsp-language-clients)). __More
info on the [wiki](https://github.com/ndonfris/fish-lsp/wiki).__

![fish-lsp --help](https://imgur.com/VvCVg24.png)
<!-- ![helpmsg](https://i.imgur.com/Xypl9PN.png) -->

## Installation
1. Create the `fish-lsp` command via one of the following methods
    <details>
    <!-- <summary>Using npm <b><i><ins>(UNTESTED, install from source is recommended)</ins></i></b>&nbsp;&nbsp;&nbsp;&nbsp;<img alt="Static Badge" src="https://img.shields.io/badge/recommended-white?style=plastic&logo=npm&logoColor=%235f5fd7&labelColor=%23000&color=%235f5fd7" wight="50%" /> -->

    <summary>Using npm <b><i><ins>(UNTESTED, install from source)</ins></i></b>&nbsp;&nbsp;&nbsp;&nbsp;<img alt="Static Badge" src="https://img.shields.io/badge/NOT_recommended-white?style=plastic&logo=npm&logoColor=%235f5fd7&labelColor=%23000&color=%235f5fd7" wight="50%" />
    </summary>

    >    ```fish
    >    npm i -g fish-lsp
    >    ```
    </details>
    <details>
    <summary>Build from source&nbsp;&nbsp;&nbsp;&nbsp;<img alt="Static Badge" src="https://img.shields.io/badge/for_contributing-blue?style=plastic&logo=devdotto&labelColor=grey" height="50%">
    </summary>

    >  * clone the repository
    >  * enter the directory
    >    ```fish
    >    cd ./fish-lsp
    >    ```
    >  * run install commands:
    >    ```fish
    >    yarn # install dependencies
    >    yarn setup # build the project using './script/*.sh' 
    >    ```
    </details> 
    <details>
    <summary>Using release binaries&nbsp;&nbsp;&nbsp;&nbsp;<a href="https://github.com/ndonfris/fish-lsp/releases"><img alt="Static Badge" src="https://img.shields.io/badge/release%20branch-black?style=plastic&logo=powershell&logoColor=%23ce3df3&labelColor=%23000&color=%23ce3df3" height="50%"></a></summary>

    > ***Currently is not recommended for use as the release binaries are error
    > prone and not fully tested.***
    >    * navigate to the [releases](https://github.com/ndonfris/fish-lsp/master/releases), and download the file for your OS
    >    * Rename file to fish-lsp (make sure the binary is executable as well)
    >        ```fish
    >        # cd to downloaded location 
    >        mv fish-lsp-linux fish-lsp 
    >        chmod +x ./fish-lsp
    >        ```
    >    * move the binary to your __\$PATH__: 
    >        ```fish
    >        mv ./fish-lsp ~/.local/bin/fish-lsp
    >        ```
    </details>

1. Build and store completions:
    ```fish
    fish-lsp complete --fish > ~/.config/fish/completions/fish-lsp.fish
    ```

1. Provide the `fish-lsp` command to start the server from a language client 
    ```json
    {
      "languageserver": {
        "fish-lsp": {
            "command": "fish-lsp",
            "args": ["start"],
            "filetypes": ["fish"]
        }
      }
    }
   ```
    > configuration shown for "coc.nvim"
    > lua and other language-client configuration syntax's 
    > can be built by fish-lsp startup-configuration <filetype>.
    > Demo shows different hover documentation, go-to definition, go-to references
    > and some other features.
   <center>

   ![usage gif](https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExaWkwcDY5aTg1OGltbDV6cGh4cGU4a204cGd1aHd6MmNpMWRrZ2d1biZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/PdSL9U8GXwV8xECE8k/giphy.gif)

   </center> 

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
| __Telescope Integration__ | Integrates with the telescope.nvim plugin | ✅ |
| __CLI Interactivity__ | Provides a CLI for server interaction. Built by `fish-lsp complete <option>` | ✅ |
| __Client Tree__ | Shows the defined scope as a Tree | ✅ |
| __Indexing__ | Indexes all commands, variables, and functions | ✅ |

## Viewing the [Wiki](https://github.com/ndonfris/fish-lsp/wiki)
Contains more information on the project, including the future roadmap, and
contribution guidelines. Project is still in it's early releases, so the wiki
information is subject to change. Contains ['minimal' client submodules](https://github.com/ndonfris/fish-lsp-language-clients),
useful snippets, and bleeding edge feature documentation.

## Sources
This project aims to be a more feature rich alternative to some of it's predecessors,
while maintaining an editor agnostic server implantation. The following sources were
major influences on the project's overall design and structure.

- __Official Documentation__
  - [__LSP__](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#headerPart)
  - [__LSIF__](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#headerPart)
  - [__vscode-extension-samples__](https://github.com/microsoft/vscode-extension-samples/tree/main)
  - [__Tree-Sitter__](https://tree-sitter.github.io/tree-sitter/)
  - [__Tree-Sitter-Fish__](https://github.com/ram02z/tree-sitter-fish)

- __Related/Similiar projects__
  - [vscode-languageserver-node/testbed](https://github.com/microsoft/vscode-languageserver-node/tree/main/testbed)
  - [awk-language-server](https://github.com/Beaglefoot/awk-language-server/tree/master/server)
  - [bash-language-server](https://github.com/bash-lsp/bash-language-server/tree/main/server/src)
  - [coc.fish](https://github.com/oncomouse/coc-fish)
  - [typescript-language-server](https://github.com/typescript-language-server/typescript-language-server#running-the-language-server)
  - [coc-tsserver](https://github.com/neoclide/coc-tsserver)

- __Important Packages__
  - [vscode-jsonrpc](https://www.npmjs.com/package/vscode-jsonrpc)
  - [vscode-languageserver](https://github.com/Microsoft/vscode-languageserver-node)
  - [vscode-languageserver-textdocument](https://github.com/Microsoft/vscode-languageserver-node)

- __Default Implementation Git Repos__
  - [client implementation](https://github.com/microsoft/vscode-languageserver-node/blob/main/client/src/common)
  - [server implementation](https://github.com/microsoft/vscode-languageserver-node/tree/main/server/src/common)  