# AWK Language Server

[![tests](https://github.com/Beaglefoot/awk-language-server/actions/workflows/tests.yml/badge.svg)](https://github.com/Beaglefoot/awk-language-server/actions/workflows/tests.yml)
[![npm](https://img.shields.io/npm/v/awk-language-server)](https://www.npmjs.com/package/awk-language-server)

Implementation of AWK Language Server based on [tree-sitter](https://github.com/tree-sitter/tree-sitter) and [tree-sitter-awk](https://github.com/Beaglefoot/tree-sitter-awk).

## Features

- [x] Syntax highlighting
- [x] Diagnostics
- [x] Autocomplete
  - [x] Builtins
  - [x] User defined symbols
- [x] Hints on hover
  - [x] Builtins
  - [x] User defined symbols
- [x] Go to definition
- [x] Code outline & symbol references
- [x] Document symbols
- [x] Workspace symbols
- [x] Rename symbols
- [x] Code formatting (requires [prettier-plugin-awk](https://github.com/Beaglefoot/prettier-plugin-awk))

## How to use with editors

### VSCode

VSCode extension is developed as part of this project and can be downloaded from marketplace [here](https://marketplace.visualstudio.com/items?itemName=beaglefoot.awk-ide-vscode).

### Vim

- `npm install -g "awk-language-server@>=0.5.2"`
- Choose and install plugin with support for LSP (some examples are below).
- Configure plugin to use `awk-language-server`.

#### [ALE](https://github.com/dense-analysis/ale)

Add following to `.vimrc`:
```vim
call ale#linter#Define('awk', {
\   'name': 'awk-language-server',
\   'lsp': 'stdio',
\   'executable': 'awk-language-server',
\   'command': '%e',
\   'project_root': { _ -> expand('%p:h') }
\})
```

Note that with such configuration `project_root` will be set to directory containing opened awk file.

#### [CoC](https://github.com/neoclide/coc.nvim)

Edit config with `:CocConfig` command and add the following:
```json
{
  "languageserver": {
    "awk": {
      "command": "awk-language-server",
      "args": [],
      "filetypes": ["awk"]
    }
  }
}
```

#### [vim-lsp](https://github.com/prabirshrestha/vim-lsp)

It works partially unless [support for multi-root workspaces](https://github.com/prabirshrestha/vim-lsp/issues/1069)
is implemented by vim-lsp.

Add to your `.vimrc`:
```vim
if executable('awk-language-server')
    au User lsp_setup call lsp#register_server({
        \ 'name': 'awk-language-server',
        \ 'cmd': {server_info->['awk-language-server']},
        \ 'allowlist': ['awk'],
        \ })
endif
```

### Nvim

#### [nvim-lspconfig](https://github.com/neovim/nvim-lspconfig)

A [default config](https://github.com/neovim/nvim-lspconfig/blob/master/doc/server_configurations.md#awk_ls)
for `awk-language-server` was
[merged into nvim-lspconfig](https://github.com/neovim/nvim-lspconfig/pull/1665#event-5938617547).
It works only if `workspaceFolders` requests are handled and a default
handler for these was only just
[set to be added upstream in Neovim 0.7](https://github.com/neovim/neovim/pull/17149/), so
the config itself is gated for use only in Neovim >= v0.7. For users below that version,
please use a manual config that handles these requests by adding the following to your
`init.vim` (or `init.lua`):
```lua
lua << EOF
local configs = require('lspconfig.configs')
local lspconfig = require('lspconfig')
if not configs.awklsp then
  configs.awklsp = {
    default_config = {
      cmd = { 'awk-language-server' },
      filetypes = { 'awk' },
      single_file_support = true,
      handlers = {
        ['workspace/workspaceFolders'] = function()
          return {{
            uri = 'file://' .. vim.fn.getcwd(),
            name = 'current_dir',
          }}
        end
      }
    },
  }
end
lspconfig.awklsp.setup{}
EOF
```

## Notes

AWK Language Server supports `AWKPATH`. If you prefer to place all your awk libs in some directory
and then `@include` it without dir name, then simply pass this env variable to your editor of choice.

```sh
AWKPATH=./include vim main.vim
```

or

```sh
export AWKPATH=./include
vim main.vim
```

Check [this cool project](https://github.com/djanderson/aho) for inspiration.

## Contributing

Thanks for considering it.

Please check this [guide](./CONTRIBUTING.md).
