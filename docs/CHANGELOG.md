## <small>1.0.11-pre.12 (2025-08-23)</small>

* fix: `scripts/build-assets.fish` simplified ([e5ee660](https://github.com/ndonfris/fish-lsp/commit/e5ee660))
* fix: `src/cli.ts` correctly starts from inside `src/main.ts` ([5119155](https://github.com/ndonfris/fish-lsp/commit/5119155))
* fix: `src/cli.ts` uses function to parse instead of namespace ([c5ee59f](https://github.com/ndonfris/fish-lsp/commit/c5ee59f))
* fix: include `bin/fish-lsp` in git tracking ([d69bc58](https://github.com/ndonfris/fish-lsp/commit/d69bc58))
* fix: resolve relative workspace symbols `source ./parent/file.fish` ([e39d1e1](https://github.com/ndonfris/fish-lsp/commit/e39d1e1))
* feat: added `--no-color` switch to output generated from `--dump-parse-tree` ([f352750](https://github.com/ndonfris/fish-lsp/commit/f352750))
* feat: added `info --dump-parse-tree <FILE>` && `tests/test-workspace-utils.ts` ([88a3085](https://github.com/ndonfris/fish-lsp/commit/88a3085))
* feat: added `yarn publish-nightly` script ([528671a](https://github.com/ndonfris/fish-lsp/commit/528671a))
* feat: added build-assets script for publishing ([38df754](https://github.com/ndonfris/fish-lsp/commit/38df754))
* feat: bundle all entry points to `./dist/fish-lsp` ([088a663](https://github.com/ndonfris/fish-lsp/commit/088a663))
* feat: workspace testing util setup ([7af26d2](https://github.com/ndonfris/fish-lsp/commit/7af26d2))
* chore: bundle remove from rebase ([94eed7f](https://github.com/ndonfris/fish-lsp/commit/94eed7f))
* chore: for bundle w/ relative source paths working ([0213561](https://github.com/ndonfris/fish-lsp/commit/0213561))
* chore: prepack auto-commit changes before pack 08/21/25 09:16:50 ([37cfc3b](https://github.com/ndonfris/fish-lsp/commit/37cfc3b))
* docs: automated commit `v1.0.11-pre.11` ci/cd 2025-08-07 ([8a9f34a](https://github.com/ndonfris/fish-lsp/commit/8a9f34a))



## <small>1.0.11-pre.12 (2025-08-23)</small>

* fix: `scripts/build-assets.fish` simplified ([e5ee660](https://github.com/ndonfris/fish-lsp/commit/e5ee660))
* fix: `src/cli.ts` correctly starts from inside `src/main.ts` ([5119155](https://github.com/ndonfris/fish-lsp/commit/5119155))
* fix: `src/cli.ts` uses function to parse instead of namespace ([c5ee59f](https://github.com/ndonfris/fish-lsp/commit/c5ee59f))
* fix: include `bin/fish-lsp` in git tracking ([d69bc58](https://github.com/ndonfris/fish-lsp/commit/d69bc58))
* fix: resolve relative workspace symbols `source ./parent/file.fish` ([e39d1e1](https://github.com/ndonfris/fish-lsp/commit/e39d1e1))
* feat: added `--no-color` switch to output generated from `--dump-parse-tree` ([f352750](https://github.com/ndonfris/fish-lsp/commit/f352750))
* feat: added `info --dump-parse-tree <FILE>` && `tests/test-workspace-utils.ts` ([88a3085](https://github.com/ndonfris/fish-lsp/commit/88a3085))
* feat: added `yarn publish-nightly` script ([528671a](https://github.com/ndonfris/fish-lsp/commit/528671a))
* feat: added build-assets script for publishing ([38df754](https://github.com/ndonfris/fish-lsp/commit/38df754))
* feat: bundle all entry points to `./dist/fish-lsp` ([088a663](https://github.com/ndonfris/fish-lsp/commit/088a663))
* feat: workspace testing util setup ([7af26d2](https://github.com/ndonfris/fish-lsp/commit/7af26d2))
* chore: bundle remove from rebase ([94eed7f](https://github.com/ndonfris/fish-lsp/commit/94eed7f))
* chore: for bundle w/ relative source paths working ([0213561](https://github.com/ndonfris/fish-lsp/commit/0213561))
* chore: prepack auto-commit changes before pack 08/21/25 09:16:50 ([37cfc3b](https://github.com/ndonfris/fish-lsp/commit/37cfc3b))
* docs: automated commit `v1.0.11-pre.11` ci/cd 2025-08-07 ([8a9f34a](https://github.com/ndonfris/fish-lsp/commit/8a9f34a))



## <small>1.0.11-pre.11 (2025-08-07)</small>

* chore: cleanup `src/{cli,server}.ts` ([3938393](https://github.com/ndonfris/fish-lsp/commit/3938393))
* fix: added test for `tests/format-aligned-columns.test.ts` for `fish-lsp info` ([e8d7ab1](https://github.com/ndonfris/fish-lsp/commit/e8d7ab1))
* fix: use vitest instead of jest ([22ca3ff](https://github.com/ndonfris/fish-lsp/commit/22ca3ff)), closes [#105](https://github.com/ndonfris/fish-lsp/issues/105)
* build: fixup `scripts/esbuild/file-watcher.ts` for initial `.start()` ([5ce6545](https://github.com/ndonfris/fish-lsp/commit/5ce6545))
* build: renamed moved paths: {build,test-data,docs/man} -> {dist,lib,bin,tests,man} ([d8a3a1d](https://github.com/ndonfris/fish-lsp/commit/d8a3a1d))
* build: tooling for `esbuild` (single `lib/server.d.ts` type definitions file) ([f1fd227](https://github.com/ndonfris/fish-lsp/commit/f1fd227))
* build: updates to esbuild script, and `src/utils/path-resolution.ts` ([6b072e2](https://github.com/ndonfris/fish-lsp/commit/6b072e2))
* build: use esbuild instead of babel ([21538ee](https://github.com/ndonfris/fish-lsp/commit/21538ee))
* refactor: removed overlapping namespace from `src/utils/commander-cli-subcommand.ts` ([7cda805](https://github.com/ndonfris/fish-lsp/commit/7cda805))
* feat: `fish-lsp info --time-startup` && `fish-lsp info --time-only` support ([0eb1918](https://github.com/ndonfris/fish-lsp/commit/0eb1918))
* feat: added/updated completions to `cli` ([ac0271c](https://github.com/ndonfris/fish-lsp/commit/ac0271c))
* feat: changes related to eslint + added browser support ([09035a3](https://github.com/ndonfris/fish-lsp/commit/09035a3))
* perf: 1400ms full server start ~2100 files indexed ([9ace93d](https://github.com/ndonfris/fish-lsp/commit/9ace93d))



## <small>1.0.11-pre.9 (2025-07-30)</small>

* chore: bump v1.0.11-pre.8 ([5af45ad](https://github.com/ndonfris/fish-lsp/commit/5af45ad))
* chore: bump v1.0.11-pre.8 ([b0f2e47](https://github.com/ndonfris/fish-lsp/commit/b0f2e47))
* chore: bump v1.0.11-pre.9 ([3055d60](https://github.com/ndonfris/fish-lsp/commit/3055d60))
* fix: `3002` global env variable `fish_lsp_strict_conditional_command_warnings` ([3282238](https://github.com/ndonfris/fish-lsp/commit/3282238)), closes [#93](https://github.com/ndonfris/fish-lsp/issues/93)
* fix: `fish-lsp env --show-default | source` no longer breaks server usage ([27b94cb](https://github.com/ndonfris/fish-lsp/commit/27b94cb))
* fix: `fish-lsp info --path` instead of `fish-lsp info --repo` ([d795120](https://github.com/ndonfris/fish-lsp/commit/d795120))
* fix: `realpath` diagnostic `2004` not shown when has options in arguments ([7b5d533](https://github.com/ndonfris/fish-lsp/commit/7b5d533))
* fix: expansion of cartesian product and update tree-sitter-fish ([15675bf](https://github.com/ndonfris/fish-lsp/commit/15675bf))
* feat: added diagnostic `4008` for requiring `function _ -d/--description` flags ([68647e6](https://github.com/ndonfris/fish-lsp/commit/68647e6))
* feat: added env variable `fish_lsp_prefer_builtin_fish_commands` diagnostic 2004 ([9a207d3](https://github.com/ndonfris/fish-lsp/commit/9a207d3))
* feat: added hover support for `{a,b,c}/{d,e,f}` and `--` ([4daf5e3](https://github.com/ndonfris/fish-lsp/commit/4daf5e3))
* feat: updated `fish-lsp info --<TAB>` ([82573b8](https://github.com/ndonfris/fish-lsp/commit/82573b8))
* refactor: `fish_files/expand_cartesian.fish` remove unused ([e0e1c75](https://github.com/ndonfris/fish-lsp/commit/e0e1c75))



## <small>1.0.11-pre.8 (2025-07-29)</small>

* chore: bump v1.0.11-pre.8 ([b0f2e47](https://github.com/ndonfris/fish-lsp/commit/b0f2e47))
* feat: added env variable `fish_lsp_prefer_builtin_fish_commands` diagnostic 2004 ([9a207d3](https://github.com/ndonfris/fish-lsp/commit/9a207d3))
* feat: added hover support for `{a,b,c}/{d,e,f}` and `--` ([4daf5e3](https://github.com/ndonfris/fish-lsp/commit/4daf5e3))
* feat: updated `fish-lsp info --<TAB>` ([82573b8](https://github.com/ndonfris/fish-lsp/commit/82573b8))
* fix: `3002` global env variable `fish_lsp_strict_conditional_command_warnings` ([3282238](https://github.com/ndonfris/fish-lsp/commit/3282238)), closes [#93](https://github.com/ndonfris/fish-lsp/issues/93)
* fix: `fish-lsp info --path` instead of `fish-lsp info --repo` ([d795120](https://github.com/ndonfris/fish-lsp/commit/d795120))



## <small>1.0.11-pre.7 (2025-07-26)</small>

* ci: bump v1.0.11 ([267f0ea](https://github.com/ndonfris/fish-lsp/commit/267f0ea))



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
