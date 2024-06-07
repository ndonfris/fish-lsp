<!-- markdownlint-disable-file -->
# Contributing :busts_in_silhouette:

The [fish-lsp](https://fish-lsp.dev) aims to create an experience that aligns with the [fish](https://fishshell.com) language goals.

In a quick overview, the project hopes to create a development environment that is as
_friendly_ as possible.

_Thanks for the interest in contributing to the project_ :pray:

---

__There are many ways to contribute to the project:__

- Submit bugs, and help work on fixes
- __Refactor__ out unnecessary source code 
- Implement features, outlined in the [roadmap](./ROADMAP.md).
- Implement new client configurations, outlined in this [repo](https://github.com/ndonfris/fish-lsp-language-clients/blob/master/)
- Add [tests](https://github.com/ndonfris/fish-lsp/blob/master/test-data) to verify expected behavior.
- Update __documentation__, across any of the project's repositories

## Getting started :rocket:

1. Begin by forking the project, then [build your local fork](../README.md#installation) :card_file_box:.

2. Once you have installed the local fork of the project (_i.e.,_ you have a successfully
compiled `fish-lsp` executable, and have a working [client configuration](https://github.com/ndonfris/fish-lsp-language-clients)),
you can then begin [testing locally](#helpful-workflows) :memo:.

3. Upon completing a change, submit a [PR](https://github.com/ndonfris/fish-lsp/pulls) :tada:.

## Places to Start :checkered_flag:

- [Roadmap](./ROADMAP.md) - _future ideas to support_
- [Issues and discussions](https://github.com/ndonfris/fish-lsp/discussions) - _get ideas from others_
- [Sources](https://github.com/ndonfris/fish-lsp/wiki/sources) - _helpful insight about potential features you want to adapt_

> [!NOTE]
> Browsing both [wiki/sources#vscode-extensions-examples](https://github.com/ndonfris/fish-lsp/wiki/sources#vscode-extension-examples) and [ROADMAP](./ROADMAP.md) are the easiest method for
> understanding how to create future [fish-lsp feature's](https://github.com/ndonfris/fish-lsp#features)

## Helpful Workflows :hourglass:

### Test Driven Development Workflow :hatching_chick:

Since __stdin/stdout__ are reserved for the protocol to communicate, a generally
successful method to achieve quick results, is through [TDD (Test Driven
Development)](https://en.wikipedia.org/wiki/Test-driven_development). Many tree-sitter helper functions ([tree-sitter.ts](../src/utils/tree-sitter.ts), and [node-types.ts](../src/utils/node-types.ts)) have already been written, to
aid in providing useful functionality for generic support of any possible
combination need for future types.

Having said that, if you a need for a new definition in [tree-sitter.ts](../src/utils/tree-sitter.ts) or [node-types.ts](../src/utils/node-types.ts) comes up,
adding it to the proper file is fine (`tree-sitter.ts` genrally deals with movement or interacting with
a `SyntaxNode[] | Tree`, where as `node-types.ts` generally deals with filter
functions that can determine what __type__ of `SyntaxNode` is passed into it).
The only requirement is that you will for new additions to these files, is that
you include proper tests in their corresponding [test-data/{node-types,tree-sitter}.test.ts](https://github.com/ndonfris/fish-lsp/blob/master/test-data/))


<details>
<summary> Sceenshot </summary>

![](https://github.com/ndonfris/fish-lsp/blob/d797189991cb55259d28aa43ff15b547fb454835/unit-testing.png?raw=true)

</details>

### Integration Testing Workflow :exploding_head:

Test directly in the [client](https://github.com/ndonfris/fish-lsp-language-clients) of your choosing. _This is a more difficult to setup_,
but could be helpful if you are testing specific behaviors like the interacting
with [fish-lsp's environment variables](https://github.com/ndonfris/fish-lsp/?tab=readme-ov-file#environment-variables), [configuration options](https://github.com/ndonfris/fish-lsp/?tab=readme-ov-file#command-flags), handler testing or
other more specific tasks.

<details>
<summary> Screenshot </summary>

![](https://github.com/ndonfris/fish-lsp/blob/d797189991cb55259d28aa43ff15b547fb454835/integration-testing.png?raw=true)

</details>

### How to Build using these Workflows :building_construction:

1. __Pull up__ some Documentaion :microscope:
   - [lsif](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#languageFeatures) - The official Language Server Protocol specification
   - [wiki/sources](https://github.com/ndonfris/fish-lsp/wiki/sources) - Sources that are similar to this project
   - [roadmap](./ROADMAP.md) - Ideas/Documentation for future plans 

1. __Create__ a `file` in the [test-data/](https://github.com/ndonfris/fish-lsp/tree/master/test-data) directory :construction_worker:
    - __START WITH VERY BASIC EXAMPLES!!!__  [Pure functions](https://en.wikipedia.org/wiki/Pure_function) are your friend
    - Checkout [./test-data/helpers.ts](../test-data/helpers.ts), `setLogger()` which is provided for `logging` tests
    - Test your `FILE.test.ts` with command: `yarn test FILE --watchAll`
    - Feel free to overwrite _any existing test-file_ that is not in the
    [package.json](../package.json) key `test-hook`
    - Use `import { initalizeParser } from '../src/parser` for building
    `SyntaxNode[]` [composite object](https://en.wikipedia.org/wiki/Composite_pattern) arrays (aka [trees](https://en.wikipedia.org/wiki/Tree_traversal)).

1. __Iteratively__ continue improving your feature :infinity:
    - Once you have a feature's hard coded input & outputs working as
    expected, you can begin trying to impalement it as an actual `server.handler`
    - You can try adding logging to your feature's specific `handlerParams`, to get an exact
      example of it's shape. (_This is the premise outlined via:_ [integration testing workflow](#integration-testing-workflow-explodinghead))

      > ```fish
      > # display the logs
      > tail -f $(fish-lsp info --logs-file)
      > ```

    - Alternatively, you can mock the data-type from the `vscode-languageserver`
    or refer to the [same documentation on lsif](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#definitionParams)

1. __Add__ your feature to a [server.ts](../src/server.ts) `handler` :handshake:
    - Document your handler, if necessary. 
    - Feel free to submit your [server handler](../src/server.ts) in __seperate__ working release stages, 
    instead of trying to build entire feature's independently. (_i.e._, if your
    `CodeAction's` only support a singular `CodeActionType`)
    - Submit your [PR](https://github.com/ndonfris/fish-lsp/pulls) :champagne:


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

## Helpful Topics and Concepts :books:

[Currying](https://en.wikipedia.org/wiki/Currying) is a useful design pattern, that makes iterating through the
[Abstract Syntax Trees (ASTs)](https://en.wikipedia.org/wiki/Abstract_syntax_tree) significantly less error prone. 

> [!NOTE]
> While it is still not entirely perfect, errors that appear to be caused by inconsistencies
> in our [node-types.ts](../src/utils/node-types.ts) [functors](https://en.wikipedia.org/wiki/Functor_(functional_programming)) are more likely to be
> caused by the earlier language server protocol versions requirement for our Nodes in our tree items, to be stored as a flat list.
> 
> Due to this reason, the project has undergone a significant rewrite of previously
> working features (diagnostics, etc...). __Working on reintroducing the disabled features would be a great place to start__, 
> as many of [server](../src/server.ts) providers were implemented using range based location
> calculation's to abide to their prior protocol use.
> 
> Relevant examples for each of the feature's mentioned above are included @ [wiki/sources](https://github.com/ndonfris/fish-lsp/wiki/sources#vscode-extension-examples)

[Child process](https://nodejs.org/api/child_process.html) execution via sub-shells. Sub-shell environment's
are extensively relied on throughout the code base.

[Markdown formatting syntax](https://www.markdownguide.org/basic-syntax/), and nested language support via triple backticks.

[Asynchronous processes](https://en.wikipedia.org/wiki/Asynchronous_I/O) and [race conditions](https://en.wikipedia.org/wiki/Race_condition). Especially during [src/server.ts](../src/server.ts) startup.

Prefetching relevant information and [caching](https://en.wikipedia.org/wiki/Cache_(computing)) it for global use.

## Important Tooling Provided :toolbox:

- [tree-sitter](https://www.google.com/search?client=firefox-b-1-d&q=web-tree-sitter) - used for data structures/algorithms, prevalent to the shell language.
  - `yarn sh:build-wasm ` - should handle building the wasm file
  - `@esdmr/tree-sitter-fish@3.5.1` - handles installing the actual tree-sitter-fish.wasm package
  - `web-tree-sitter` - is the API for `SyntaxNode[]`, `Parser`, `Range`, etc...

- [eslint](https://eslint.org/) - used for linting and formatting
    -  `yarn lint` - lint and fix the current project (`husky pre-push` hook)
    -  `yarn lint:verbose` - lint, and display output 

- [knip](https://github.com/webpro/knip) - used for tree-shaking and checking unused dependcies
    -  `yarn refactacor` - package.json script to run knip
    - You can _refactor_ major sections of __unused code__ of out the project easily
    with this command

- [commander.js](https://github.com/tj/commander.js) - used for [src/cli.ts](../src/cli.ts) and other tooling to start the server
    - Handles parsing the [./bin/fish-lsp](../bin/fish-lsp) `stdin`, in a structured manor

- [zod](https://github.com/colinhacks/zod) - parses the `env` into a [typesafe object](https://github.com/ndonfris/fish-lsp/blob/a41b2654cc7607993b3fd80c8560e2fdcfeca6d2/src/config.ts#L86C54-L86C55)
    - handles _parsing_ the `fish_lsp*` variables in our __node__ `process.env` object
    - _builds_ the result object in the global variable `config` 

- [vscode-languageserver](https://github.com/Microsoft/vscode-languageserver-node) - the _SPEC_ for defining our _LSP_.
    - `Objects` & `Interfaces` specific to `fish-lsp` typically __extend__ this base
    specification
    - `Type Definitions` useful for handler's are defined throughout this
    package

- [husky](https://typicode.github.io/husky/) - the [git-hooks](https://github.com/ndonfris/fish-lsp/blob/a41b2654cc7607993b3fd80c8560e2fdcfeca6d2/package.json#L42) for interacting with project's source code 
    - lints the project `on-push`
    - removes dependencies before commit `pre-commit`
    - initializes yarn `post-merge`

- [jest](https://jestjs.io/docs/configuration) - testing the project
    - relevant locations: [test-data/*.test.ts](https://github.com/ndonfris/fish-lsp/blob/master/test-data), [jest.config.js](https://github.com/ndonfris/fish-lsp/blob/master/jest.config.js) && [tsconfig.test.json](https://github.com/ndonfris/fish-lsp/blob/master/tsconfig.test.js)
    - `yarn test-hook` is a future supported feature, for specifying individual test files to opt into
    successful reporting for master branch (_via_ `git action`).
    - `yarn test someFile.test.ts --watchAll` is the designated method for watching a test's changes

### Other Noteworthy Tooling :hammer_and_wrench:

Becoming familiar with using the `src/utils/{tree-sitter,node-types}.ts` code, is significantly easier while
using the previously mentioned [TDD Workflow](#test-driven-development-workflow-hatchingchick). 

Using an equivalent tree-sitter visualization command to neovim's command, `:InspectEdit` is also 
highly recommended. If you are unsure what this command does, it essentially allows you to visualize
the AST that tree-sitter parsed from fish input. Using this while writing test
files, significantly improves the overall testing experience.

Also don't forget to make use of the [fish-lsp --flags](https://github.com/ndonfris/fish-lsp/blob/master/README.md#command-flags)! There is plenty of use cases the binary supports,
like: <br>`fish-lsp env --create`, `fish-lsp complete`,
`fish-lsp info --logs-file`, <br> `fish-lsp info --time`, `fish-lsp url
--sources`, `fish-lsp logger --show`, ___+ more...___

## Adding New Language Clients :chart_with_upwards_trend:

Generally, all that is required is using the `fish-lsp start` command, and
specifying fish for attaching the server to a filetype. Any other fluff in this
settings, as seen in the [JSON](../README.md#client-usage) example, is only for ease of use.

Adding new client configurations, to the [fish-lsp-client's](https://github.com/ndonfris/fish-lsp-language-clients/) repo, is greatly appreciated!

## Contributing Github Actions :recycle:

If you're trying to add a new github action to the project, please take a close
look at the [scripts/*](https://github.com/ndonfris/fish-lsp/tree/master/scripts) directory, along with [package.json](https://github.com/ndonfris/fish-lsp/blob/master/package.json).

A github __action__ that uses that compiles the project, requires `fish` to be
installed and setup, before `yarn` in the __action__.

The current [workflow actions](https://github.com/ndonfris/fish-lsp/tree/master/.github/workflows), are the best place to see how this is achieved.

## Got helpful scripts? :passport_control:

[Show & tell](https://github.com/ndonfris/fish-lsp/discussions) is a helpful place to document your useful configurations for working on the fish-lsp.

Displaying demos, features and other cool discoveries are also welcome :)
