# fish-lsp

Experimental language server for the [fish shell](https://fishshell.com/). Upstream [branches](https://github.com/ndonfris/fish-lsp/branches) offer various features for the fish shell, but are highly experimental. Maintainers are welcome to contribute, as the project is still in its infancy.  

![usage gif](https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExaWkwcDY5aTg1OGltbDV6cGh4cGU4a204cGd1aHd6MmNpMWRrZ2d1biZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/PdSL9U8GXwV8xECE8k/giphy.gif)
> showing different hover documentation, goto definition, goto references and some other features.

## Current Features, and Documentation

[server.ts]( ./src/server.ts ) methods are bound as handlers to the client. Unchecked nested bullets are either: handlers which are currently __WIP__ or __features__ to further possibly extend a hanlder's functionality.

- [x] onComplete
  - [x] documentation to support chained short options (e.g. `ls -la`)
  - [x] get unique local symbols
  - [ ] get fallback to global symbols
  - [ ] implementation does not consider all possible cases. Currently has issues
      with completions being found on empty word.
- [x] onCompleteResolve
- [x] onHover
  - [x] support chained short options: `ls -la`
  - [x] support commands with subcommands: `git commit`
  - [x] support local symbols: `~/.config/fish/config.fish`, `~/.config/fish/functions/*.fish`
  - [x] support nearest reference: `set var "1"; set var "2";`
- [x] onDefinition
- [x] onReferences
  - [x] when searching for global references, remove new locally defined references
        from matches
- [x] onRename, __(does not work for renaming autoloaded files)__
  - [x] when searching for global references, remove new locally defined references
        from matches
- [x] onDocumentSymbol
- [x] onWorkspaceSymbol
- [x] onFold
- [x] onFormat
- [x] onFormatRange
- [ ] diagnostics
  - [ ] tons of possibility for future ideas here. Diagnostic Provider is implemented upstream.
- [ ] onCodeAction
- [ ] onOutgoingCallHierarchy
- [ ] onIncomingCallHierarchy
- [ ] onRefactor
- [ ] onInlayHints: _previous implementation too slow_
- [x] [documentation.ts]( ./src/documentation.ts )
- [x] [analyze.ts]( ./src/analyze.ts )
  - [ ] implement diagnostics
  - [x] `analyze()` cache a document and its relevant information for later use.
  - [x] `getCommandAtLine()` for `onComplete()/onHover()`
  - [x] `initiateBackgroundAnalysis()` non-blocking analysis over workspace paths, to
    analyze/cache all auto-loaded files.
- [x] [completion.ts]( ./src/completion.ts )
  - [ ] add __pipe__, __status__, __escape char__, and __wild card__  completions
  - [x] add completion short options, that are chained together via retrigger command.
  - [ ] add option for sorting by __short/long__ options first
  - [ ] add option for client _completion-menu_ `FishDocumentItem.detail` to be shown
  - [ ] add completion type resolver (strategy to construct `FishCompletionItem[]`)
- [x] [logger.ts]( ./src/logger.ts ) logging for a FishServer connection. Will log to
`./logs.txt` by default.
- [x] [cli.ts]( ./src/cli.ts ) __starts__ the language server. A client will attach to
this endpoint, and provide specific configuration options on startup.
  - [coc.nvim](#current-recommendations)
  - nvim native lsp: __TODO__
- [ ] [code-actions.ts]( ./src/code-actions.ts ) implement code actions
  - use `CodeActionContext.create()` to create contexts, potentially while also creating
      diagnostics at the same time.
  - Need to get range working for `CodeActions`. Otherwise, it will only work on the first line
      of the document.
- [ ] [code-lens.ts]( ./src/code-lens.ts ) implement code lens
- [ ] [calls.ts]( ./src/calls.ts ) implement `outgoingCalls` and `incomingCalls` provider
- [x] [translation]( ./src/utils/translation.ts ) convert data-types across various package api's.
- [x] [parser.ts]( ./src/parser.ts ) contains `initializeParser()` to use `.wasm` tree-sitter module [web-tree-sitter](https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web).  
  - [ ] Convert from [web-tree-sitter](https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web) to [tree-sitter-node](https://github.com/tree-sitter/node-tree-sitter). __NOTICE__: _Notice that executing .wasm files in node.js is considerably slower than running node.js bindings._
- [ ] [configManager.ts]( ./src/configManager.ts ) implement configuration manager. __Client Configuration Settings__ accessible during startup.

## Development

- For local environment I use [neovim](https://github.com/neovim/neovim/wiki/Installing-Neovim) with [coc.nvim]( https://github.com/neoclide/coc.nvim ):

```json
{
    "languageserver": {
        "fishls": {
            "command": "$HOME/path/to/fish-lang-server/out/cli.js",
            "filetypes": ["fish"],
            "args": ["--stdio"],
            "revealOutputChannelOn": "info",
            "initializationOptions": {
                "workspaces": {
                    "paths": {
                        "defaults": [
                            "$HOME/.config/fish",
                            "/usr/share/fish"
                            ]
                        }
                    }
            }
        }
    }
}
```

- Development setup has also been tested with [native neovim lsp](https://github.com/neovim/nvim-lspconfig/tree/master)
- To get your own setup working, you will need to:
    1. clone the repo
    2. run:

        ```fish
        npm install && npm run build
        # pnpm install && pnpm run build
        # yarn install && yarn build
        ```

    3. You will need the [tree-sitter-fish](https://github.com/ram02z/tree-sitter-fish)
    package & the [tree-sitter-cli](https://github.com/tree-sitter/tree-sitter/blob/master/cli/README.md)

        ```fish
        cd ./path/to/fish-lsp
        ./install-script.sh
        # or 
        npm install tree-sitter-cli
        cd /path/to/tree-sitter-fish # see package.json for adding git path to npm
        tree-sitter build-wasm fish


        ```

    4. Most importantly, it should do-able to get into most editor's, by providing the [~/path/to/cli.js]( /src/cli.ts ) to the editor language client configuration.
    5. options provided past that are optional, and set by default during `server.on_attach()`

## Various notes

- [fish-lsp]( ./src/server.ts ) is the main entry point for the language server.
- [test-data]( ./test-data/ ) contains the test data for the language server. Here is
  the quickest way to get a grasp of major features.

    ```fish
    npm run test analyze # to test: `./fish_data/analyze.test.ts`
    ```

- [DocumentSymbol]( https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_documentSymbol ) has been implemented
across various branches, I still have not figured out the best way to resolve a symbol
based on scope using this protocol.
- [SymbolInformation]( https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#symbolInformation ) has been implemented,
but was abandoned due to official documentation stating that it is deprecated. Having now
used the DocumentSymbol protocol, the tree structure that this protocol avoids makes it
significantly easier to implement across server handlers.

> NOTE: you can not use partial result: `DocumentSymbol[] | SymbolInformation[]. DocumentSymbol[]` and `SymbolInformation[]` can not be mixed. That means the first chunk defines the type of all the other chunks.

- [node-types.ts](./src/utils/node-types.ts) contains the node types for the fish language. A more verbose version of tokenization via [tree-sitter-fish](#tree-sitter-fish), would make [node-types.ts](./src/utils/node-types.ts) significantly more readable. It would
also greatly simplify the process of detecting what the type of a node is. __If you are interested in helping with this, please reach out__

<center>

| fish-shell                  | TreeSitter.SyntaxNode.type   |
|:---------------------------:|:---------------------------:|
|`set --local var "value"`    | var.type === 'word'         |
| `echo "$var"`               | var.type === 'variable'     |
> the above example is showing the `TreeSitter.SyntaxNode` containing character sequence: `var`

</center>

- [tree-sitter.ts]( ./src/utils/tree-sitter.ts ) contains the node flattening and searching utilities for the fish language.

## Debugging && Testing

- when testing a server handler on an actual fish file, the logger by default will print
output to `~/path/to/repo/logs.txt`. I typically run the following command in a separate
shell, to display the logs:  

    ```fish
    echo "" > logs.txt && tail -f logs.txt
    ```

- when testing specific files/implementation, writing tests inside the [./test-data/](./test-data/) directory are typically the most effective approach.
  - you can `console.log()` the [jest](https://github.com/jestjs/jest) test-suites, by calling the [helpers.ts](./test-data/helpers.ts) function:

        ```typescript
        import {setLogger} from './helpers'

        setLogger()
        describe("your feature to test", () => {
            it('test1', async () => {
                // ...test code...
                console.log('test1') // logs to normal console instead of jest console
            }
        })
        ```

## fish shell snippets:

```fish
# get all functions
function --all | string split ','
```

```fish
# get all events
functions --handlers | string match -vr '^Event \w+' | string split -n '\n'
```

```fish
# get all variables
abbr --show
```

```fish
# get documentation for a function
functions -D -v 'function_name'
# /home/ndonfris/.config/fish/functions/function_name.fish                                        │
# autoloaded                                                                            │
# 3                                                                                     │
# scope-shadowing                                                                       │
```


## Sources

- [__LSIF__](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#headerPart)
- [__vscode-extension-sampes__](https://github.com/microsoft/vscode-extension-samples/tree/main)

- __Similiar projects__
  - [coc.fish]( https://github.com/oncomouse/coc-fish )
  - [awk-language-server]( https://github.com/Beaglefoot/awk-language-server/tree/master/server )
  - [bash-language-server]( https://github.com/bash-lsp/bash-language-server/tree/main/server/src )
  - [typescript-language-server](https://github.com/typescript-language-server/typescript-language-server#running-the-language-server)
  - [coc-tsserver](https://github.com/neoclide/coc-tsserver)

- __Important Packages__
  - [vscode-jsonrpc]( https://www.npmjs.com/package/vscode-jsonrpc )
  - [vscode-languageserver]( https://github.com/Microsoft/vscode-languageserver-node )
  - [vscode-languageserver-textdocument]( https://github.com/Microsoft/vscode-languageserver-node )

- __Default Implementation Git Repos__
  - [client implementation]( https://github.com/microsoft/vscode-languageserver-node/blob/main/client/src/common )
  - [server implementation]( https://github.com/microsoft/vscode-languageserver-node/tree/main/server/src/common )  