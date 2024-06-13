# CHANGELOG

Documenting notable changes across project verisions

===

## Current

## \[1.0.5\] - 2024-06-7 ([PR #33](https://github.com/ndonfris/fish-lsp/pull/33))

- added new contributors
- added `DocumentHighlight` handler
- added `SignatureHelp` handler (_minimal_)
- updated README.md
- fixed issues: #32, #33, #34

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
