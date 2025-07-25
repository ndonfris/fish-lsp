## <small>1.0.11-pre.6 (2025-07-26)</small>

* ci: v1.0.11-pre.6 ([3e7d278](https://github.com/ndonfris/fish-lsp/commit/3e7d278))



## <small>1.0.11-pre.5 (2025-07-25)</small>

* fix: `fish-lsp info --check-health` min node version ([2a853eb](https://github.com/ndonfris/fish-lsp/commit/2a853eb))
* fix: `FishSymbol` w/ `set --function` definition `scopeNode` #99 + `fish-lsp info` change (#101) ([a82fd69](https://github.com/ndonfris/fish-lsp/commit/a82fd69)), closes [#99](https://github.com/ndonfris/fish-lsp/issues/99) [#101](https://github.com/ndonfris/fish-lsp/issues/101) [#99](https://github.com/ndonfris/fish-lsp/issues/99)
* fix: added vscode module features ([dea7266](https://github.com/ndonfris/fish-lsp/commit/dea7266))
* fix: prevent crashes caused by read `FishSymbol` (#98) ([7066ee1](https://github.com/ndonfris/fish-lsp/commit/7066ee1)), closes [#98](https://github.com/ndonfris/fish-lsp/issues/98)
* fix: variable refs #92 && invalid code-actions #91  (#94) ([435e272](https://github.com/ndonfris/fish-lsp/commit/435e272)), closes [#92](https://github.com/ndonfris/fish-lsp/issues/92) [#91](https://github.com/ndonfris/fish-lsp/issues/91) [#94](https://github.com/ndonfris/fish-lsp/issues/94)
* feat: add `out/**/*.d.ts` to compiled code + `"main"/"typings"` `package.json` ([25cb262](https://github.com/ndonfris/fish-lsp/commit/25cb262))
* feat: support es2025 iterators and minor tweaks to symbol utilities for #96 (#97) ([067c384](https://github.com/ndonfris/fish-lsp/commit/067c384)), closes [#96](https://github.com/ndonfris/fish-lsp/issues/96) [#97](https://github.com/ndonfris/fish-lsp/issues/97) [#96](https://github.com/ndonfris/fish-lsp/issues/96)
* feat: use `Babel` to compile valid `ES2025` syntax to `node>=18` (#102) ([b9a43aa](https://github.com/ndonfris/fish-lsp/commit/b9a43aa)), closes [#102](https://github.com/ndonfris/fish-lsp/issues/102)
* chore: bump deps for v1.0.11 ([298821d](https://github.com/ndonfris/fish-lsp/commit/298821d))
* chore: bump form-data in the npm_and_yarn group across 1 directory (#100) ([faa069a](https://github.com/ndonfris/fish-lsp/commit/faa069a)), closes [#100](https://github.com/ndonfris/fish-lsp/issues/100)
* docs: updated `docs/ROADMAP.md` ([730eab3](https://github.com/ndonfris/fish-lsp/commit/730eab3))

## <small>1.0.10 (2025-07-11)</small>

* fix: added tslib to package.json dev dependency ([45c1ac2](https://github.com/ndonfris/fish-lsp/commit/45c1ac2))
* fix: bump to v1.0.9-1 to remove tslib dep ([ae36543](https://github.com/ndonfris/fish-lsp/commit/ae36543))
* fix: diagnostics and code actions from other clients (#82) ([67675c9](https://github.com/ndonfris/fish-lsp/commit/67675c9)), closes [#82](https://github.com/ndonfris/fish-lsp/issues/82)
* fix: false positives for local functions #80 (#81) ([d870374](https://github.com/ndonfris/fish-lsp/commit/d870374)), closes [#80](https://github.com/ndonfris/fish-lsp/issues/80) [#81](https://github.com/ndonfris/fish-lsp/issues/81) [#80](https://github.com/ndonfris/fish-lsp/issues/80)
* fix: minor fixes to `--check-health` output ([e0c643c](https://github.com/ndonfris/fish-lsp/commit/e0c643c))
* fix: narrow variable references for matching command names ([d406d5e](https://github.com/ndonfris/fish-lsp/commit/d406d5e))
* docs: added `4007` diagnostic to snippets and README.md ([523021b](https://github.com/ndonfris/fish-lsp/commit/523021b))
* docs: synced `./docs/*` files to source code published for `v1.0.9-1` ([a25dd1d](https://github.com/ndonfris/fish-lsp/commit/a25dd1d))
* feat: build stadalone binaries  (#83) ([36af0b4](https://github.com/ndonfris/fish-lsp/commit/36af0b4)), closes [#83](https://github.com/ndonfris/fish-lsp/issues/83)
* feat: parsing functions with event hook support (#89) ([4563f89](https://github.com/ndonfris/fish-lsp/commit/4563f89)), closes [#89](https://github.com/ndonfris/fish-lsp/issues/89)
* chore: bump deps @dependabot ([440de78](https://github.com/ndonfris/fish-lsp/commit/440de78))

## <small>1.0.9-1 (2025-05-23)</small>

* fix: added tslib to package.json dev dependency ([45c1ac2](https://github.com/ndonfris/fish-lsp/commit/45c1ac2))
* fix: npm install error using tslib ([93a5091](https://github.com/ndonfris/fish-lsp/commit/93a5091))

## <small>1.0.9 (2025-05-21)</small>

* release/v1.0.9 (#78) ([715d765](https://github.com/ndonfris/fish-lsp/commit/715d765)), closes [#78](https://github.com/ndonfris/fish-lsp/issues/78) [#76](https://github.com/ndonfris/fish-lsp/issues/76)
* fix: `./scripts/build-time` now uses node for mason.nvim tests (#71) ([9e25626](https://github.com/ndonfris/fish-lsp/commit/9e25626)), closes [#71](https://github.com/ndonfris/fish-lsp/issues/71)
* fix: bump `.nvmrc` to 22.14.0 ([8f13575](https://github.com/ndonfris/fish-lsp/commit/8f13575))
* fix: comment disable function diagnostics (#75) ([da187f9](https://github.com/ndonfris/fish-lsp/commit/da187f9)), closes [#75](https://github.com/ndonfris/fish-lsp/issues/75)
* fix: document-symbol-highlights handler in server (#73) ([1952f6a](https://github.com/ndonfris/fish-lsp/commit/1952f6a)), closes [#73](https://github.com/ndonfris/fish-lsp/issues/73) [#66](https://github.com/ndonfris/fish-lsp/issues/66)
* fix: remove "pkg" from `package.json` & remove duplicates from `.npmignore` ([c517ec0](https://github.com/ndonfris/fish-lsp/commit/c517ec0))
* fix: removed/corrected failing tests (`yarn test` now exits 0) ([1bff10b](https://github.com/ndonfris/fish-lsp/commit/1bff10b))
* fix: reset log file on initialize when changed (#70) ([bd647a3](https://github.com/ndonfris/fish-lsp/commit/bd647a3)), closes [#70](https://github.com/ndonfris/fish-lsp/issues/70) [#69](https://github.com/ndonfris/fish-lsp/issues/69)
* fix: update config from init_options before server start (#76) ([b46dab6](https://github.com/ndonfris/fish-lsp/commit/b46dab6)), closes [#76](https://github.com/ndonfris/fish-lsp/issues/76)
* feat: added `update-changelog` script w/ `conventional-changelog` dep ([4abd29f](https://github.com/ndonfris/fish-lsp/commit/4abd29f))
* feat: support initializationOptions (#69) ([db2e754](https://github.com/ndonfris/fish-lsp/commit/db2e754)), closes [#69](https://github.com/ndonfris/fish-lsp/issues/69)
* feat: update workflows & add `.github/workflows/check-npm-release.yml` ([004fc5d](https://github.com/ndonfris/fish-lsp/commit/004fc5d))
* chore: added @ClanEver to .all-contributorsrc ([5adf24d](https://github.com/ndonfris/fish-lsp/commit/5adf24d))
* chore: clean up tracked files, workflow fixes, update git/husky hooks ([4535cd9](https://github.com/ndonfris/fish-lsp/commit/4535cd9))
* chore: removed .npmignore ([fefe872](https://github.com/ndonfris/fish-lsp/commit/fefe872))
* chore: updated man file ([d8780ab](https://github.com/ndonfris/fish-lsp/commit/d8780ab))
* chore(deps): bump the npm_and_yarn group across 1 directory with 2 updates (#72) ([01712c8](https://github.com/ndonfris/fish-lsp/commit/01712c8)), closes [#72](https://github.com/ndonfris/fish-lsp/issues/72)
* docs: update `README.md` shields w/ clickable links ([e3ad7ba](https://github.com/ndonfris/fish-lsp/commit/e3ad7ba))

## \[1.0.8-4\] - 2025-01-20 ([PR #64](https://github.com/ndonfris/fish-lsp/pull/64))

* added code actions

  * added comment string to disable diagnostics
  * added create completions file diagnostic for function with argparse
  * added convert alias to function code action
  * added convert alias to function code action in new function file
  * added convert if statement to combiner code action
  * added refactor code actions for functions/variables
  * added action to delete unused functions
  * added argparse end stdin code action

* added diagnostics

  * warning, autoloaded function does not have a function definition `4001`
  * warning, autoloaded function name does not match file name `4002`
  * error, function uses keyword as name `4003`
  * warning, unused function `4004`

* added diagnostic comment string
* added `$` completion trigger
* fixed `README.md` docs
* added local `CompletionItem` symbol support
* added vscode to `README.md` client installation instructions
* updated documentation for `fish-lsp` features (in output: `fish-lsp info`, `fish-lsp env`)

## \[1.0.8-3\] - 2024-07-24 ([PR #62](https://github.com/ndonfris/fish-lsp/pull/62) & [PR #63](https://github.com/ndonfris/fish-lsp/pull/63/files))

* __updated__ docs to reflect changes in `1.0.8-2`
* __updated__ `src/document.ts` to update `textDocument/didChange` correctly
* __updated__ `package.json` to include `version: 1.0.8-3`
* __closed issues:__ [#57](https://github.com/ndonfris/fish-lsp/issues/57), [#50](https://github.com/ndonfris/fish-lsp/issues/50), [#48](https://github.com/ndonfris/fish-lsp/issues/48)
* __tested__ `fish-lsp` installation across different node package managers.

## \[1.0.8-2\] - 2024-06-12 ([PR #62](https://github.com/ndonfris/fish-lsp/pull/62))

* __fixed__ `npm/yarn/pnpm` installation issues
* __added__ `.npmignore` file
* __updated__ `fish-lsp complete` completions, like `fish-lsp --<TAB>` support
* __moved__ `npm-run-all` to `dependencies` from `devDependencies`
* __changed__ __build from source__ installation to use `dev` command
* __added__ `README.md` client installation instructions for many new clients:
  * coc.nvim
  * nvim-lspconfig
  * vim-lsp
  * kakoune
  * helix
  * emacs
* __changed__ env variables supported by `fish-lsp` & updated `README.md` to reflect changes
* __edited__ `postinstall` script to allow for package manager installations to properly install `fish-lsp`. This primarily effects the completions and manpage installation.
* __edited__ `setup` script to ease installation for `npm/yarn/pnpm` users
* __updated__ node requirements in `package.json` to `>=18.0.0`
* __updated__ `.nvmrc` to use `22.12.0`
* __added__ `fish-lsp info --time-startup` to show startup time
* __included__ minor changes to `test-data/**.test.ts` files. Particularly, added the `src/execute-handler.ts` file
* __updated__ `.github/workflows/ci.yaml` to include `yarn dev` command, for proper testing

## \[1.0.8\] - 2024-07-24 (PR [#49](https://github.com/ndonfris/fish-lsp/pull/49) & [#47](https://github.com/ndonfris/fish-lsp/pull/47))

* __logging__ to a file is now an __opt-in__ feature.
* [src/logger.ts](https://github.com/ndonfris/fish-lsp/blob/5e06a271f522cb88f78b5c398fcca4057cbcc9c6/src/logger.ts#L45) does not _forward to a file_ unless one has been given via `$fish_lsp_logsfile`
* __added__ [#49](https://github.com/ndonfris/fish-lsp/pull/49) 'feat: logging behaviour opt-in set by '$fish_lsp_logsfile' - #49'
* __removed__ `logging` keys from `$fish_lsp_enabled_handlers` and `$fish_lsp_disabled_handlers` env variables
* __added__ [#46](https://github.com/ndonfris/fish-lsp/pull/46), 'feat: add ability to override `wasm_file`' for [nixpkg](https://github.com/NixOS/nixpkgs/pull/320463)

> __CHANGES ALSO SEEN ON:__ [1.0.8-1](https://github.com/ndonfris/fish-lsp/blob/v1.0.8-1/)

## \[1.0.7\] - 2024-06-28 ([PR](https://github.com/ndonfris/fish-lsp/commit/7bba6bc5064a5f07a3e11e7ca1d20366ea74a13a)) 

* updated `fish_lsp_enabled_handlers` & `fish_lsp_disabled_handlers`
  documentation on [README.md](https://github.com/ndonfris/fish-lsp/blob/7bba6bc5064a5f07a3e11e7ca1d20366ea74a13a/README.md?plain=1#L163)
* minor changes to __improve__ [nixpkg](https://github.com/NixOS/nixpkgs/pull/330320) support, mostly documentation related

## \[1.0.6\] - 2024-06-12 ([PR #38](https://github.com/ndonfris/fish-lsp/pull/38)) 

* added server `sendDiagnostic` support
* added testing for server `diagnostic` support
* updated dependencies (tree-sitter-fish, eslint, jest)
* removed unnecessary dev dependencies

## \[1.0.5\] - 2024-06-07 ([PR #33](https://github.com/ndonfris/fish-lsp/pull/33))

* added new contributors
* added `DocumentHighlight` handler
* added `SignatureHelp` handler (_minimal_)
* updated README.md
* fixed issues: #32, #33, #34
* added `onExecuteCommand` handler

## \[1.0.4\] - 2024-05-22 ([PR #23](https://github.com/unclechu/node-deep-extend/pull/23))

* added `./src/snippets/*.json`
* included new [user config](../src/config.ts) options from `.env`
* removed `fish-lsp bare` support
* added `fish-lsp env` support
* major changes to documentation
  * added [mermaid](https://github.com/ndonfris/fish-lsp/tree/upstream.docs#how-does-it-work) docs to readme
  * added contributors to [readme](https://github.com/ndonfris/fish-lsp/tree/upstream.docs#contributors)
  * added new github actions
* adds __hover__ support for `pipes` & `status numbers`
* adds __signature__ handler for specific important shell variables

### [PR #21](https://github.com/unclechu/node-deep-extend/pull/21) -- 2024-05-03

* converted `scripts/*.sh` to `scripts/*.fish`
  * package.json _run-scripts_ now calls `fish script/file.fish`
* added abbr to [src/utils/builtins.ts](../src/utils/builtins.ts)
* moved shebang to `/usr/bin/fish` to `/usr/local/bin/fish`
  * or used `/usr/bin/env fish`
* mam-page updated
* added `--help-*` hidden flags

## \[1.0.3\] - 2024-05-29

* Added CHANGELOG.md
* Changed [`scripts/build-time.sh`](../scripts/build-time.fish) to 24 hour format
* [README.md](../README.md) major formatting changes
* [Wiki](https://github.com/ndonfris/fish-lsp/wiki) additions
* added _contributors_ to [CONTRIBUTING](./CONTRIBUTING.md), via `.all-contributorsrc`
* removed tsup
* fixed `logs.txt` and `src/logger.ts`
* removed support for `fish-lsp startup-configurations` subcommand, that used `lua-json` dependency

## \[1.0.2\]

* added `tsup` dependency
* added `marked-man` manpage compiler
* added `knip` dependency

## \[1.0.1\]

* released on [npm](https://www.npmjs.com/package/fish-lsp)
* improved docs
* Included multiple methods of installation

## \[1.0.0\] - Initial Release

* Main project files
