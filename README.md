#  fish-lsp 

Experimental language server for the fish shell. Upstream [branches]( https://github.com/ndonfris/fish-lsp/branches ) offer various features
for the fish shell, but are highly experimental. Maintainers are welcome to contribute, 
as the project is still in its infancy.  

![](https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNXVjeWx6cGp6eHRtZnpoMmppN3JkempqZzI3OG9sNTc3aWozbnFpOCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/HIvxnghggOOpdgqDEi/giphy.gif)
> showing different hover documentation, goto definition, and some other features.

- [ ] [server.ts]( ./src/server.ts )
    - [x] onFold
    - [x] onComplete
        - [ ] still needs minor tweaks to support chained short options 
        - [x] support ranges
    - [x] diagnostics
        - [ ] tons of possibility for future ideas here. Diagnostic Provider is implemented upstream.
- [x] [documentation.ts]( ./src/documentation.ts )
- [x] [analysis.ts]( ./src/analyzer.ts )
    - [x] implement diagnostics
    - [x] `getCommandAtLine()` for `onComplete()/onHover()`
- [x] [completion.ts]( ./src/completion.ts )
    - [x] fix/update to v.8.0.2 with `editRange` in `CompletionList.create()`
    - [x] fix WorkspaceSymbol/DocumentSymbol completions
    - [x] add in completion short options, that are chained together.
    - [ ] add in option for sorting by short options first
    - [ ] add in option for including descriptions 
- [ ] [code-actions.ts]( ./src/code-actions.ts ) implement code actions
    - use `CodeActionContext.create()` to create contexts, potentially while also creating
      diagnostics at the same time.
    - Need to get range working for `CodeActions`. Otherwise, it will only work on the first line
      of the document.
- [ ] [code-lens.ts]( ./src/code-lens.ts ) implement code lens

## Current recommendations:
- For production I have use neovim with [coc.nvim]( https://github.com/neoclide/coc.nvim ):
```json
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
                        ],
                },
            }
            //"additionalSchemes": ['']
        },
    },
```
- Development setup has also been tested with [cmp.nvim]( https://github.com/hrsh7th/nvim-cmp )
- To get your own setup working, you will need to:
    1. clone the repo
    2. run: `npm install && npm run build`
    3. You will need the [ tree-sitter-fish ]( https://github.com/ram02z/tree-sitter-fish ) package & the [ tree-sitter-cli ]( https://github.com/tree-sitter/tree-sitter/blob/master/cli/README.md ) 
    ```fish
    npm install tree-sitter-cli
    cd /path/to/tree-sitter-fish # see package.json for adding git path to npm
    tree-sitter build-wasm fish
    ```
    4. Most importantly, it should do-able to get into most editor's, by providing the [~/path/to/cli.js]( /src/cli.ts ) to the editor language client configuration.
    5. options provided past that are optional, and set by default during `server.on_attach()`


## Various notes:
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
- [node-types.ts]( ./src/utils/node-types.ts ) contains the node types for the fish language. A more verbose version of tokenization via [tree-sitter-fish](#tree-sitter-fish), would make this file significantly more readable. It would
also greatly simplify the process of detecting what the type of a node is. [ __If you are interested in helping with this, please reach out.__ ]

<center>

| fish-shell                  | TreeSitter.SyntaxNode.type   |
|:---------------------------:|:---------------------------:|
|`set --local var "value"`    | var.type === 'word'         |
| `echo "$var"`               | var.type === 'variable'     |

</center>

- [tree-sitter.ts]( ./src/utils/tree-sitter.ts ) contains the node flattening and searching utilities for the fish language.





## Sources for project thus far

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



---