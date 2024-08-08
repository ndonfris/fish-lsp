# CHANGELOG

Documenting notable changes across project revisions

===

## Current

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