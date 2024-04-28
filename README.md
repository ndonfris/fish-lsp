<!-- # ![](https://github.com/ndonfris/fish-lsp.dev/blob/ndonfris-patch-1/coloricon.svg) FISH-LSP -->
<h1 style="text-align: center; display: flex;">
    <img src="https://github.com/ndonfris/fish-lsp.dev/blob/ndonfris-patch-1/coloricon.svg" width="25px" height="25px" style="padding-top: auto" /> FISH-LSP
</h1>

<!-- todo -->
<!-- [![All Contributors](https://img.shields.io/github/all-contributors/projectOwner/projectName?color=ee8449&style=flat-square)](#contributors) -->
<!-- ![Github Created At](https://img.shields.io/github/created-at/ndonfris/fish-lsp?labelColor=%23000&color=%234e6cfa) -->
<!-- ![Gitter](https://img.shields.io/gitter/room/ndonfris/fish-lsp) -->
<!-- ![GitHub Discussions](https://img.shields.io/github/discussions/ndonfris/fish-lsp)  -->
<!-- ![GitHub last commit](https://img.shields.io/github/last-commit/ndonfris/fish-lsp) -->
<!-- ![GitHub repo size](https://img.shields.io/github/repo-size/ndonfris/fish-lsp) -->

<!-- - [SUMMARY](#summary) -->
<!-- - [INSTALLATION](#installation) -->
<!-- - [FEATURES](#features) -->
<!-- - [CONTRIBUTING](./docs/CONTRIBUTING.md) -->
<!-- - [ROADMAP](./docs/ROADMAP.md) -->
<!-- - [WIKI](#viewing-the-wiki) -->
<!-- - [SOURCES](#sources) -->
<!-- ======= -->
<!-- ![typescript](https://img.shields.io/badge/logo-typescript-blue?logo=typescript&logoColor=%234e6cfa&labelColor=%23181939) -->
![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/ndonfris/fish-lsp/eslint.yml?branch=master&labelColor=%23181939)
![License](https://img.shields.io/github/license/ndonfris/fish-lsp?&labelColor=%23181939&color=b88af3)
![Github Created At](https://img.shields.io/github/created-at/ndonfris/fish-lsp?logo=%234e6cfa&label=created&labelColor=%23181939&color=%236198f5)
<!-- ![Gitter](https://img.shields.io/gitter/room/ndonfris/fish-lsp?color=%234e6cfa&labelColor=%23181939) -->

<!-- ![Open Source Love](https://badges.frapsoft.com/os/v1/open-source.svg?v=103&color=%23181939) -->

<!-- ![Github PR's](https://badgen.net/github/prs/ndonfris/fish-lsp?color=%234e6cfa&labelColor=%23181939)  -->
<!-- ![Gitter](https://img.shields.io/gitter/room/ndonfris/fish-lsp?logo=github&label=created&labelColor=%23181939&color=%236198f5) -->

<!-- ![Github Created At](https://img.shields.io/github/created-at/ndonfris/fish-lsp) -->
<!-- - [SUMMARY](#summary) -->
<!-- - [INSTALLATION](#installation) -->
<!-- - [FEATURES](#features) -->
<!-- - [CONTRIBUTING](./docs/CONTRIBUTING.md) -->
<!-- - [ROADMAP](./docs/ROADMAP.md) -->
<!-- - [WIKI](#viewing-the-wiki) -->
<!-- - [SOURCES](#sources) -->
<!-- ## Summary -->

Language Server Protocol (LSP) implementation specifically tailored for the [fish shell](https://github.com/microsoft/vscode-languageserver-node/tree/main/server/src/common).
This project aims to enhance the coding experience for fish, by introducing a suite of
intelligent features like auto-completion, syntax highlighting, and more.

<!-- A __feature-rich__, __extensible__, and __blazingly fast__ [language-server](https://github.com/microsoft/vscode-languageserver-node/tree/main/server/src/common) for the [fish-shell](https://fishshell.com/). -->
<!-- Uses [tree-sitter](https://tree-sitter.github.io/tree-sitter/), [tree-sitter-fish](https://github.com/ram02z/tree-sitter-fish), [yarn](https://yarnpkg.com/) and [typescript](https://www.typescriptlang.org/). -->
<!-- Implements both standard & non-standard features from the [language-server-protocol](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#headerPart), to be connected to a language-client ([neovim](https://neovim.io/),[coc.nvim](https://github.com/neoclide/coc.nvim), [vscode](https://code.visualstudio.com/), [etc.](https://github.com/ndonfris/fish-lsp-language-clients)). -->
<!-- __More info on the [wiki](https://github.com/ndonfris/fish-lsp/wiki).__ -->

The langauge server protocol describes both a server and client communication. Text editor's (_or any other equivalent form of_ __langauge client__) are then able to choose which general
programming features will be implemented. This leaves the possibilities for the server to
be open ended and general. The general goal of this project will be to continue
expanding supported features _(within repsective reason)_ that fish's community can create.

<!-- Here is good description from the author of [fish-ide on VSCode](https://github.com/yourusername/fish-ide): -->

<!-- Supporting this project is mutually beneficial to -->
<!-- the entire community. -->

<!-- Producing a comprehensive user interface that aligns with the ideology of the -->
<!-- __FRIENDLY INTERACTIVE SHELL__ continues to be a difficult task. Supporting this -->
<!-- project is both requested and encouraged until reaching a more mature code base. -->

<!-- Achieving ideal solution's to each new LSP release is unstable by nature, -->
<!-- and has been reworked in multiple instances. Please try to consider the time -->
<!-- and dedication required to achieve the current project's state. -->

<!-- Here is author of  -->
<!-- alternative project that is probably more stable, -->
<!---->
<!-- I built this project because of my general love of simplicity for the fish -->
<!-- shell. Across many other IDEs/PDEs/Text Editor's, I eventually decided to begin building -->
<!-- this project out of interest in LSP, and would recommend people  -->


<!-- also been many have been a plethura of requests for someone  -->
<!-- other developer experience, please use your  -->

<!-- add quote from vscode implemenation here? -->
<!-- Achieving ideal solution's to each new LSP release is unstable by nature, -->
<!-- and has been reworked in multiple instances. Please try to consider the time -->
<!-- and dedication required to achieve the current project's state. -->

<!--

> "[this](https://github.com/yourusername/fish-ide) is a ~100 lines of code project made to fix up a few syntax highlighting bugs, while a real LSP would be more like 10,000 lines of code that requires a lot of knowledge of the fish internals. This is similar to a formatter, which might be pretty complicated to write from scratch, but it was no problem to add formatting to this extension by calling out to the official fish shell's fish_indent executable."
>
> — *Contributor from [fish-ide on VSCode](https://github.com/yourusername/fish-ide)*
-->

<!-- Lastly, consider checking if there is currently something of interest that you'd be willing to work on. -->
<!-- The [unsupported features](#features) sections and our [roadmap](./docs/ROADMAP.md), are good places to start getting -->
<!-- comfortable contributing to this project. -->

<!-- Please try to be considerate of where you direct questions about questions that are related to -->
<!-- this project. Especially while the core team is currently undergoing the rust rewrite. It is -->
<!-- detrimental to  -->
<!-- This project aims to streamline to it's new user's will probably require some testing for maturity to continue. -->
<!-- expect for downloading this project, verified by  sharing specific solutions to the current -->
<!-- protocal iteration produces a multititude of benefits for  -->
<!-- differences will prevent  -->
<!-- improve the overall scope of support from other developers. -->
<!--  Which  -->

<!-- ### Example Server Documentation -->
<!---->
<!-- ![fish-lsp --help](https://i.imgur.com/M6Zm3yW.png) -->
<!---->
<!--   > _Output built from running command:_ `fish-lsp --help` -->

<!-- ### Example Client Usage -->
<!---->
<!-- _Please submit other demo's in_ [show & tell](https://github.com/ndonfris/fish-lsp/discussions/categories/show-and-tell) _discussion_ -->
<!---->
<!-- ![demo.gif](https://github.com/ndonfris/fish-lsp/blob/fe52c7fb50173be7de80a4fa0db25ddc1e3a7498/fish-lsp-2024-4-25.gif)    -->
<!--- ![usage gif](https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExaWkwcDY5aTg1OGltbDV6cGh4cGU4a204cGd1aHd6MmNpMWRrZ2d1biZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/PdSL9U8GXwV8xECE8k/giphy.gif)--->
<!-- > lua and other language-client configuration syntax's -->
<!-- > configuration shown for "coc.nvim" -->
<!-- > can be built by fish-lsp startup-configuration <filetype>. -->
<!-- > Demo shows different hover documentation, go-to definition, go-to references -->
<!-- > and some other features. -->

<!-- ![helpmsg](https://i.imgur.com/Xypl9PN.png) -->
<!-- ![alt](https://player.vimeo.com/video/930061064?h=eaf4bb5804) -->
<!-- <iframe src="https://player.vimeo.com/video/930061064?h=eaf4bb5804" frameborder="0" webkitallowfullscreen mozallowfullscreen allowfullscreen></iframe> -->
<!-- <iframe src="https://player.vimeo.com/video/930061064?h=eaf4bb5804" width="640" height="360" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe> -->
<!-- <p><a href="https://vimeo.com/930061064">fish-lsp demo</a> from <a href="https://vimeo.com/user217605615">nick donfris</a> on <a href="https://vimeo.com">Vimeo</a>.</p> -->
<!-- ![Downloads](https://img.shields.io/github/downloads/ndonfris/fish-lsp/total) -->
<!-- ![Website](https://fish-lsp.dev) -->
<!-- ![Code Style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg) -->
<!-- ![Code Quality](https://img.shields.io/codeclimate/maintainability/ndonfris/fish-lsp) -->
<!-- ![Chat on Discord]() -->
<!-- ![Dependencies](https://img.shields.io/librariesio/github/ndonfris/fish-lsp) -->

### Client Usage


  ![demo.gif](https://github.com/ndonfris/fish-lsp.dev/blob/ndonfris-patch-1/new_output.gif?raw=true)

 > [!NOTE]
 > _Please submit other demo's in_ [show & tell](https://github.com/ndonfris/fish-lsp/discussions/categories/show-and-tell) _discussion_


### Server documentation

  ```bash
   fish-lsp --help
  ```

  <details>
    <summary> Generated Output </summary>

  ![fish-lsp --help](https://github.com/ndonfris/fish-lsp.dev/blob/ndonfris-patch-1/public/help-msg.png)

  </details>

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

## Viewing the Wiki

The [wiki](https://github.com/ndonfris/fish-lsp/wiki)  Contains more information on the project. Project is still in it's early releases, so the wiki
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

<!-- Contributors list @via: https://allcontributors.org/docs/en/bot/installation -->
## Contributors

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->
