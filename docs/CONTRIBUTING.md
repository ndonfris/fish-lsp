# Contributing

The [fish-lsp](https://fish-lsp.dev) aims to create an experience that aligns with the [fish](https://fishshell.com) language goals.

In short, the project hopes to create a development environment that is as
_friendly_ as possible.

---

There are many ways to contribute to the project:

- Submit bugs, and help work on fixes
- __Refactor__ out unnecessary source code.
- Implement features, outlined in the [roadmap](./ROADMAP.md).
- Implement new client configurations, outlined in this [repo](https://github.com/ndonfris/fish-lsp-language-clients/blob/master/)
- Add [tests](https://github.com/ndonfris/fish-lsp/blob/master/test-data) to verify expected behavior.
- Update documentation, across any of the project's repositories

## Getting started

Working on the project, will require you to __build it from source__.

You will then be required to `link` the project to your global environment.

Once these steps are complete, you can then begin testing locally. __Forking__ _the
project is encouraged._

Upon completing a change, submit a [PR](https://github.com/ndonfris/fish-lsp/pulls).

## Recommended workflow & Helpful Insight

Since stdin/stdout are reserved for the protocol to communicate, a generally
successful method to achieve quick results, is through TDD (Test Driven
Development). Many tree-sitter helper functions have already been written, to
aid in providing useful functionality further down the release cycle.

[Currying](https://en.wikipedia.org/wiki/Currying) is a useful design pattern,
that makes iterating through the [Abstract Syntax Trees (ASTs)](https://en.wikipedia.org/wiki/Abstract_syntax_tree) significantly
less error prone. Earlier language server protocol versions required the Nodes
in our tree items, to be stored as a flat list. Due to this reason, there has
been the need for a significant rewrite of previously working features
(diagnostics, etc...). __This would be a great place to start__, as many of
[server](../src/server.ts) providers are implemented using range based location
calculation's to abide to their prior protocol use.

Features that receive bumps in support will eventually be supported as an opt in
design through the application config _(also needs a rewrite)_. This will allow
experimental feautures to the user's who understand what they are testing. I
have included [zod](https://github.com/colinhacks/zod), as a dependency for reading in `process.env` variables to the user's configuration.

> Until this is completed, I am sorry for any unintended bugs.

## Important Tooling Provided

- [tree-sitter](https://www.google.com/search?client=firefox-b-1-d&q=web-tree-sitter) - used for data structures/algorithms, prevelant to the shell language.
- [eslint](https://eslint.org/) - used for linting and formatting
- [knip](https://github.com/webpro/knip) - used for tree-shaking and checking unused dependcies
- [commander.js](https://github.com/tj/commander.js) - used for [src/cli.ts](../src/cli.ts) and other tooling to start the server

Becoming framiliar with using the tree-sitter code, is signficantly easier while
using the previously mentioned __TDD__. Although, another helpful method is
avaliable for any neovim devlepers via the `:InspectEdit` command. This will
allow you to visualize the AST that tree-sitter parsed from fish input.

## Adding support to new Langauge Clients/Editors

Generally, all that is required is using the `fish-lsp start` command, and
specifying fish for attaching the server to a filetype. Any other fluff in this
settings, as seen in the [JSON](../README.md#client-usage) example, is only for ease of use.

Adding new client configurations, to the [fish-lsp-client's](https://github.com/ndonfris/fish-lsp-language-clients/) repo, is greatly appreciated!

## Contributors
<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

