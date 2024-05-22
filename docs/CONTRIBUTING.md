# Contributing

The [fish-lsp](https://fish-lsp.dev) aims to create an experience that aligns with the [fish](https://fishshell.com) language goals.

In a quick overview, the project hopes to create a development environment that is as
_friendly_ as possible.

_Thanks for the interest in contributing to the project_ 🙏


---

There are many ways to contribute to the project:

- Submit bugs, and help work on fixes
- __Refactor__ out unnecessary source code.
- Implement features, outlined in the [roadmap](./ROADMAP.md).
- Implement new client configurations, outlined in this [repo](https://github.com/ndonfris/fish-lsp-language-clients/blob/master/)
- Add [tests](https://github.com/ndonfris/fish-lsp/blob/master/test-data) to verify expected behavior.
- Update documentation, across any of the project's repositories

## Getting started

1. Begin by forking the project, then [build your local fork](../README.md#installation) :card_file_box:.

2. Once you have installed the local fork of the project (_i.e.,_ you have a successfully
compiled `fish-lsp` executable, and have a working [client configuration](https://github.com/ndonfris/fish-lsp-language-clients)),
you can then begin testing locally :memo:.

3. Upon completing a change, submit a [PR](https://github.com/ndonfris/fish-lsp/pulls) :tada:.

## Places to start

- [ROADMAP](./ROADMAP.md) - _future ideas to support_
- [Issues and discussions](https://github.com/ndonfris/fish-lsp/discussions) - _get ideas from others_
- [Sources](https://github.com/ndonfris/fish-lsp/wiki/sources) - _helpful insight about potential features you want to adapt_

## Workflows

### TDD Workflow

Since stdin/stdout are reserved for the protocol to communicate, a generally
successful method to achieve quick results, is through TDD (Test Driven
Development). Many tree-sitter helper functions have already been written, to
aid in providing useful functionality further down the release cycle.


### Integration Testing Workflow

Test directly in the client of your choosing. This is more difficult to setup,
but could be helpful if you are testing specific behaviors like the interacting
with fish-lsp's environment variables, configuration options, handler testing or
other more specific tasks.

<!---
- watch compilation on changes
 
  ```fish
  cd $(fish-lsp info --repo | tail -n1)
  yarn watch
  ```

- abbr helpful for continuosly running editor for testing

    ```fish
    abbr -a wht     --set-cursor --position command "$(string join \n -- 'while true;' '%' 'end;')"
    # while true
    #     $EDITOR ~/.config/fish/config.fish
    #     sleep 1s
    #     source ~/.config/fish/config.fish # don't forget to source any 'fish_lsp_*' variables you are testing
    #end
    ```

- display logs
    ```fish
    tail -f $(fish-lsp info --logs-file)
    ```
--->

## Helpful Topics and Concepts

[Currying](https://en.wikipedia.org/wiki/Currying) is a useful design pattern, that makes iterating through the
[Abstract Syntax Trees (ASTs)](https://en.wikipedia.org/wiki/Abstract_syntax_tree) significantly less error prone. Earlier language server
protocol versions required the Nodes in our tree items, to be stored as a flat list.
Due to this reason, there has been the need for a significant rewrite of previously
working features (diagnostics, etc...). __This would be a great place to start__, as many of
[server](../src/server.ts) providers are implemented using range based location
calculation's to abide to their prior protocol use.

[Child process](https://nodejs.org/api/child_process.html) execution via sub-shells. Sub-shell environment's
are extensively relied on throughout the code base.

[Markdown formatting syntax](https://www.markdownguide.org/basic-syntax/), and nested language support via triple backticks.

[Asynchronous processes](https://en.wikipedia.org/wiki/Asynchronous_I/O) and [race conditions](https://en.wikipedia.org/wiki/Race_condition). Especially during [src/server.ts](../src/server.ts) startup.

Prefetching relevant information and [caching](https://en.wikipedia.org/wiki/Cache_(computing)) it for global use.

## Important Tooling Provided

- [tree-sitter](https://www.google.com/search?client=firefox-b-1-d&q=web-tree-sitter) - used for data structures/algorithms, prevelant to the shell language.
- [eslint](https://eslint.org/) - used for linting and formatting
- [knip](https://github.com/webpro/knip) - used for tree-shaking and checking unused dependcies
- [commander.js](https://github.com/tj/commander.js) - used for [src/cli.ts](../src/cli.ts) and other tooling to start the server

Becoming familiar with using the tree-sitter code, is significantly easier while
using the previously mentioned __TDD__. Although, another helpful method is
avaliable for any neovim devlepers via the `:InspectEdit` command. This will
allow you to visualize the AST that tree-sitter parsed from fish input.

## Adding support to new Langauge Clients/Editors

Generally, all that is required is using the `fish-lsp start` command, and
specifying fish for attaching the server to a filetype. Any other fluff in this
settings, as seen in the [JSON](../README.md#client-usage) example, is only for ease of use.

Adding new client configurations, to the [fish-lsp-client's](https://github.com/ndonfris/fish-lsp-language-clients/) repo, is greatly appreciated!

## Add helpful scripts

[Show & tell](https://github.com/ndonfris/fish-lsp/discussions) is a helpful place to document your useful configurations for working on the fish-lsp.

Displaying demos, features and other cool discoveries is also welcomed.

<!---
## Reminders while testing

- If you are testing the shell environment variables

--->
