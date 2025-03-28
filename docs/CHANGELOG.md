## \[1.0.8-4\] - 2025-01-20 ([PR #64](https://github.com/ndonfris/fish-lsp/pull/64))

- added code actions

  - added comment string to disable diagnostics
  - added create completions file diagnostic for function with argparse
  - added convert alias to function code action
  - added convert alias to function code action in new function file
  - added convert if statement to combiner code action
  - added refactor code actions for functions/variables
  - added action to delete unused functions
  - added argparse end stdin code action

- added diagnostics

  - warning, autoloaded function does not have a function definition `4001`
  - warning, autoloaded function name does not match file name `4002`
  - error, function uses keyword as name `4003`
  - warning, unused function `4004`

- added diagnostic comment string
- added `$` completion trigger
- fixed `README.md` docs
- added local `CompletionItem` symbol support
- added vscode to `README.md` client installation instructions
- updated documentation for `fish-lsp` features (in output: `fish-lsp info`, `fish-lsp env`)

## \[1.0.8-3\] - 2024-07-24 ([PR #62](https://github.com/ndonfris/fish-lsp/pull/62) & [PR #63](https://github.com/ndonfris/fish-lsp/pull/63/files))

- __updated__ docs to reflect changes in `1.0.8-2`
- __updated__ `src/document.ts` to update `textDocument/didChange` correctly
- __updated__ `package.json` to include `version: 1.0.8-3`
- __closed issues:__ [#57](https://github.com/ndonfris/fish-lsp/issues/57), [#50](https://github.com/ndonfris/fish-lsp/issues/50), [#48](https://github.com/ndonfris/fish-lsp/issues/48)
- __tested__ `fish-lsp` installation across different node package managers.

## \[1.0.8-2\] - 2024-06-12 ([PR #62](https://github.com/ndonfris/fish-lsp/pull/62))

- __fixed__ `npm/yarn/pnpm` installation issues
- __added__ `.npmignore` file
- __updated__ `fish-lsp complete` completions, like `fish-lsp --<TAB>` support
- __moved__ `npm-run-all` to `dependencies` from `devDependencies`
- __changed__ __build from source__ installation to use `dev` command
- __added__ `README.md` client installation instructions for many new clients:
  - coc.nvim
  - nvim-lspconfig
  - vim-lsp
  - kakoune
  - helix
  - emacs
- __changed__ env variables supported by `fish-lsp` & updated `README.md` to reflect changes
- __edited__ `postinstall` script to allow for package manager installations to properly install `fish-lsp`. This primarily effects the completions and manpage installation.
- __edited__ `setup` script to ease installation for `npm/yarn/pnpm` users
- __updated__ node requirements in `package.json` to `>=18.0.0`
- __updated__ `.nvmrc` to use `22.12.0`
- __added__ `fish-lsp info --time-startup` to show startup time
- __included__ minor changes to `test-data/**.test.ts` files. Particularly, added the `src/execute-handler.ts` file
- __updated__ `.github/workflows/ci.yaml` to include `yarn dev` command, for proper testing

## \[1.0.8\] - 2024-07-24 (PR [#49](https://github.com/ndonfris/fish-lsp/pull/49) & [#47](https://github.com/ndonfris/fish-lsp/pull/47))

- __logging__ to a file is now an __opt-in__ feature.
- [src/logger.ts](https://github.com/ndonfris/fish-lsp/blob/5e06a271f522cb88f78b5c398fcca4057cbcc9c6/src/logger.ts#L45) does not _forward to a file_ unless one has been given via `$fish_lsp_logsfile`
- __added__ [#49](https://github.com/ndonfris/fish-lsp/pull/49) 'feat: logging behaviour opt-in set by '$fish_lsp_logsfile' - #49'
- __removed__ `logging` keys from `$fish_lsp_enabled_handlers` and `$fish_lsp_disabled_handlers` env variables
- __added__ [#46](https://github.com/ndonfris/fish-lsp/pull/46), 'feat: add
  ability to override `wasm_file`' for [nixpkg](https://github.com/NixOS/nixpkgs/pull/320463)

> __CHANGES ALSO SEEN ON:__ \[1.0.8-1\](https://github.com/ndonfris/fish-lsp/blob/v1.0.8-1/)

## \[1.0.7\] - 2024-06-28 ([PR](https://github.com/ndonfris/fish-lsp/commit/7bba6bc5064a5f07a3e11e7ca1d20366ea74a13a)) 

- updated `fish_lsp_enabled_handlers` & `fish_lsp_disabled_handlers`
  documentation on [README.md](https://github.com/ndonfris/fish-lsp/blob/7bba6bc5064a5f07a3e11e7ca1d20366ea74a13a/README.md?plain=1#L163)
- minor changes to __improve__ [nixpkg](https://github.com/NixOS/nixpkgs/pull/330320) support, mostly documentation related

## \[1.0.6\] - 2024-06-12 ([PR #38](https://github.com/ndonfris/fish-lsp/pull/38)) 

- added server `sendDiagnostic` support
- added testing for server `diagnostic` support
- updated dependencies (tree-sitter-fish, eslint, jest)
- removed unnecessary dev dependencies

## \[1.0.5\] - 2024-06-07 ([PR #33](https://github.com/ndonfris/fish-lsp/pull/33))

- added new contributors
- added `DocumentHighlight` handler
- added `SignatureHelp` handler (_minimal_)
- updated README.md
- fixed issues: #32, #33, #34
- added `onExecuteCommand` handler

## \[1.0.4\] - 2024-05-22 ([PR #23](https://github.com/unclechu/node-deep-extend/pull/23))

- added `./src/snippets/*.json`
- included new [user config](../src/config.ts) options from `.env`
- removed `fish-lsp bare` support
- added `fish-lsp env` support
- major changes to documentation
  - added [mermaid](https://github.com/ndonfris/fish-lsp/tree/upstream.docs#how-does-it-work) docs to readme
  - added contributors to [readme](https://github.com/ndonfris/fish-lsp/tree/upstream.docs#contributors)
  - added new github actions
- adds __hover__ support for `pipes` & `status numbers`
- adds __signature__ handler for specific important shell variables

### [PR #21](https://github.com/unclechu/node-deep-extend/pull/21) -- 2024-05-03

- converted `scripts/*.sh` to `scripts/*.fish`
  - package.json _run-scripts_ now calls `fish script/file.fish`
- added abbr to [src/utils/builtins.ts](../src/utils/builtins.ts)
- moved shebang to `/usr/bin/fish` to `/usr/local/bin/fish`
  - or used `/usr/bin/env fish`
- mam-page updated
- added `--help-*` hidden flags

## \[1.0.3\] - 2024-05-29

- Added CHANGELOG.md
- Changed [scripts/build-time.sh](../scripts/build-time.fish) to 24 hour format
- [README.md](../README.md) major formatting changes
- [Wiki](https://github.com/ndonfris/fish-lsp/wiki) additions
- added _contributors_ to [CONTRIBUTING](./CONTRIBUTING.md), via `.all-contributorsrc`
- removed tsup
- fixed `logs.txt` and `src/logger.ts`
- removed support for `fish-lsp startup-configurations` subcommand, that used `lua-json` dependency

## \[1.0.2\]

- added `tsup` dependency
- added `marked-man` manpage compiler
- added `knip` dependency

## \[1.0.1\]

- released on [npm](https://www.npmjs.com/package/fish-lsp)
- improved docs
- Included multiple methods of installation

## \[1.0.0\] - Initial Release

- Main project files
