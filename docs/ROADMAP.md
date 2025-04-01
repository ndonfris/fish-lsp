<!-- markdownlint-disable-file -->
# ROADMAP

High-level overview of the project’s goals, tasks, and milestones for future
releases.

Any new ideas related to the content here are welcome.

__Sections:__

- [Current Prioritized Changes](#current-prioritized-changes) - tasks that might are not yet supported, but are being looked into for the next major release.
- [General Codebase Changes](#general-codebase-changes) - tasks useful for future additions
- [Server Features and Providers](#server-features-and-providers) - future general features that the server provides
- [Automation and Pipelines](#automation-and-pipelines) - __CI/CD__ or __tooling__ related to the project
- [Documentation](#documentation) - modifications for the project's documentation ([wiki](https://github.com/ndonfris/fish-lsp/wiki), [README](../README.md), [site](https://fish-lsp.dev), _etc._)

## Current Prioritized Changes

- [x] Add `$__fish_**` auto-loaded environment variables to the server's startup
      configuration. An example auto-loaded variable would be `$__fish_config_dir`
- [x] Improve parsing of specific DocumentSymbols (now `FishSymbol`) by using
      more verbose rules for excluding certain tokens from `web-tree-sitter`
- [ ] Add better workspace support for non-standard/small fish workspaces. 
  **THE `server` FILE LIKELY NEEDS [workspace handlers](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#workspace_workspaceFolders)**
  - [ ] Supporting `/tmp/*.fish` buffers from things like `edit_command_buffer`/`alt-e`
  - [ ] Supporting `fisher` workspaces (consider a workspace like `~/repo/fisher-plugin`, as its own workspace without `$fish_lps_all_indexed_paths`)
      > *NOTE:* `fish_lsp_single_workspace_support` was an attempt at specifying that
      the user has opted into this feature
  - [ ] Supporting sourced files outside of workspace, and adding them to the
        workspace
- [x] Go-to-Definition && Hover support for `source some_file.fish` command
- [ ] Improving completions for `set -gx fish_lsp_*` env variables
    - [ ] adding better hover documentation to `fish_lsp_*` env variables, using
      the `options` [property](https://github.com/ndonfris/fish-lsp/blob/feat/seperating-symbols-parsing/src/snippets/fishlspEnvVariables.json)
- [ ] [Comparing](https://github.com/ndonfris/fish-lsp/tree/feat/seperating-symbols-parsing/src/parsing) already generated `complete -c cmd -s _ -l _` [completions](https://github.com/ndonfris/fish-lsp/blob/feat/seperating-symbols-parsing/src/parsing/complete.ts) to the
      a [function](https://github.com/ndonfris/fish-lsp/blob/feat/seperating-symbols-parsing/src/parsing/argparse.ts) with an `argparse` child definition, so that duplicate
      completions are not generated
  - [ ] `argparse 'n/name=' -- $argv` command could generate
        `complete -c cmd -s n -l name -a ' '` - Key difference being the `-a` flag is outputted
        There is also the `-x` and `-r` flags that could be used.
- [ ] General plumbing
  - [ ] Add more test coverage for heavily used files.
  - [x] Remove unused/deprecated files and/or functions
- [ ] Consider allowing the user to specify configuring the [`fish_indent` command](https://fishshell.com/docs/current/cmds/fish_indent.html) behavior
  - [ ] `fish v3.7.1` to ` fish v4.0.0` changes `fish_indent` behavior specifically for `;` characters to be replaced with `\n`,
        creating potentially unwanted formatting changes
  - [ ] Allow option to specify either `fish_indent --only-indent` or `fish_indent` for formatting a file.
- [ ] Update docs for using `initializationParams` in the client configuration

## General Codebase Changes

- [x] Refactor unused [files & data-structures](https://github.com/ndonfris/fish-lsp/blob/master/src)
- [x] Read a user's specific __configuration__ they have set
  - [x] `env_variables` could be set via [zod](https://github.com/colinhacks/zod)
  - [x] set options via cli flags, `fish-lsp start --enable ... --disable ...`
  - [x] use builtin fish variables for generating defaults:
  `$__fish_config_dir`, `$fish_function_path`, `$__fish_user_data_dir`
    - [some documentation on the subject](file:///usr/share/doc/fish/language.html#autoloading-functions)
    - example use for functions: `fish -c 'string split " " -- $fish_function_path'`
    - `$__fish_user_data_dir` is usually `/usr/share/fish`
- [ ] Supporting [fish feature flags](https://fishshell.com/docs/current/language.html#future-feature-flags) and handling proper syntax changes

## Server Features and Providers

- [x] Add `Diagnostics`
  - [x] add a `diagnostic queue` to store diagnostics
  - [x] enable/disable specific features [(more info available here)](https://github.com/ndonfris/fish-lsp/discussions/37):
    - [x] __Error__ - missing `end` to block
    - [ ] __Error__ - missing `switch/case` fall through check `case '*'` or `case \*`
    - [ ] __Warning__ - prefer `command`/`builtin` prefix for commands or builtins
    - [x] __Warning__ - missing completions file from a `functions/<file>.fish`
    - [ ] Test different message formats
    - [x] __disable/enable__ via env variables
    - [ ] _...add more features..._
  - [x] write verbose tests for each new diagnostic
- [x] Add `CodeActions`
  - [x] Create `completions` file
  - [x] `Quickfix` diagnostic error
  - [x] Rename autoloaded _filename_ (for a fish `function`), that doesn't have a matching function name
  - [ ] Prefer `command` prefix for possible _aliased_ shell commands.
  - [x] Move function in `~/.config/fish/config.fish` to it's own file, `~/.config/fish/functions/<file>.fish` and call it inline.
  - [ ] `if` statement to `and`/`or` equivalent, [combiner](https://fishshell.com/docs/current/tutorial.html#combiners-and-or-not) **NEEDS TO BE REMOVED ACCORDING TO FISH V4.0.0 DOCS**
- [x] Add `CodeLens` support **(CURRENTLY WE USE INLAY HINTS INSTEAD OF CodeLens)**
  - [ ] Decide what would be useful to display
    - [ ] Local reference count
    - [x] `return $status` values for functions
    - [ ] `type -t`
- [x] Add `CommandExecutor` provider
- [x] Add function `SignatureHelp` provider.
    - [ ] semi complete, needs more support. (Specifically struggles with
          determining what the current token type is)
    - [ ] add support to enable via `CompletionItem`
    - [ ] add `function _ -a first second third -d 'a function description'`
          support for parsing the values out of the options, to then be used as a more
          traditional signature handler
- [ ] Add `set_color` [Color Presentation](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_colorPresentation) to the server, for displaying how the shell would render output. 
  - [ ] Could be toggled via a server command
- [ ] `FormatOnType` provider (useful for small files)
- [x] Enable server via __shebang's__:
  - [x] `#!/usr/bin/fish`
  - [x] `#!/usr/local/bin/fish`
  - [x] `#!/usr/bin/env fish`
- [x] Add `DocumentHighlight` provider
- [x] Extend symbol definitions recognized by the server (DONE BY [./src/parsing/](https://github.com/ndonfris/fish-lsp/tree/feat/seperating-symbols-parsing/src/parsing)): 
  - [ ] variables created by `fish_opt` 
  - [x] `argparse` commands
  - [x] `alias` names
  - [x] `set` names
  - [x] `read` names
  - [x] `alias` names
  - [x] `source` names
  - [x] `for` loop variable names
  - [x] `function` names (both variables and functions)
  - [ ] `abbr` names (would theoretically need to be able to parse a `abbr --set-cursor --function`)
  - [x] include [theme variables](https://fishshell.com/docs/current/interactive.html#envvar-fish_color_normal)
  - [ ] event handlers for `function _ --on-event event`
  - [x] universal variables
- [x] Descriptions for array indexing: `echo $PATH[-1..2]`
  - [x] ensure array indexes are: `1 >= idx <= -1`
<!-- - [ ] `source` command use cases, for workspaces outside of default -->
<!--       configurations. (The `source` command, can be used similar to import in other -->
<!--       languages) -->
- [x] [status variable](https://fishshell.com/docs/current/language.html#the-status-variable) documentation
     > ```text
     > 0 is generally the exit status of commands if they successfully performed the requested operation.
     > 1 is generally the exit status of commands if they failed to perform the requested operation.
     > 121 is generally the exit status of commands if they were supplied with invalid arguments.
     > 123 means that the command was not executed because the command name contained invalid characters.
     > 124 means that the command was not executed because none of the wildcards in the command produced any matches.
     > 125 means that while an executable with the specified name was located, the operating system could not actually execute the command.
     > 126 means that while a file with the specified name was located, it was not executable.
     > 127 means that no function, builtin or command with the given name could be located.
     >```
- [ ] Options to enable from client configuration
  - [x] `if_statement` must be silent: `if command -s` -> `if command -sq`
  - [ ] prefer `command _` prefix for ambiguous commands
  - [ ] default case for  `switch_statement`
  - [x] `test` _number/string_ flags from condition argument's
  - [x] function requires returning a status number
  - [ ] `fish_add_path` instead of `set -gx PATH _`
  - [x] logger location
  - [ ] private functions need underscore prefix
  - [x] prefer `universal` scope, or prefer `global` scope
  - [ ] prefer specific `redirect` to `/dev/null`
  - [ ] hover documentation fallback: [tldr](https://tldr.sh/), [cht.sh](https://cht.sh/), _..._
  - [ ] format specific options
  - [ ] remove showing `lsp kind` in completions list
<!-- - [ ] Add __fallback support__ for _small_ workspaces, (i.e., use shell to get -->
<!--       function path, and then open/edit/etc. through client) -->
- [x] `argparse` support
  - [x] if autoloaded function has `argparse` then use values to create
        completions
  - [ ] check if all __args__ from `argparse` are included in completion
  - [ ] check if all __args__ from `argparse` have been used `_flag_arg`
  - [x] use `argparse` values as definition
- [ ] __disable/enable__ server features through `fish-lsp.command` options
- [ ] __virtual text__ - `fish_prompt` in `edit_command_buffer`. 
  - The general idea here is when an `edit_command_buffer` is opened, we could use the
  `fish_prompt` to display the prompt as virtual text inside the buffer.
  - `fish_prompt` are just ascii characters
  - `edit_command_buffer` opens an interactive buffer in the `/tmp` folder, we
    could either consider all `/tmp/*.fish` files to have this behavior, or wrap
    the `edit_command_buffer` function in another function with variables
    exported to specify when this should be used.
- [x] inlay hints - add references or some other feature
  - [x] `return $status` values for functions
  - [ ] `exit` values?
- [ ] `breakpoint` support
- [x] improve  _conf.d/*.fish_ support
  - [x] `conf.d/*.fish` files are really just treated the same as `config.fish`
  files, but are sourced before the `config.fish` file. This means, that
  something defined in a `conf.d/*.fish` file will be available everywhere, but
  might need to called/referenced to use it in an interactive shell.
- [ ] add `completion` snippets for [builtins](https://fishshell.com/docs/current/commands.html)
- [ ] `onSemanticToken` support

## Automation and pipelines

- [x] __(POTENTIALLY)__ Use [pnpm](https://pnpm.io) instead of [yarn](https://yarnpkg.com/)
- [x] Minimize `test-suite` for master branch's PR compatibility
  - [x] run via: `yarn test-hook`
- [x] Include _refactoring/tree-shaking_ help to scripts: `yarn refactor`
- [ ] Release binary downloadable files, per machine OS
  - [ ] need a build pipeline as well
  - [ ] handle scope specific dependencies
- [ ] Action for updating [fish-lsp.dev](https://github.com/ndonfris/fish-lsp.dev) documentation on new publishes
  - [x] write script for generating `fish-lsp --help` screenshot
- [x] add action testing `fish-lsp --help` is successfully built on __os matrix__ (would be _mac_ and _unix_)

## Documentation

- [ ] Add new [editor configurations](https://github.com/ndonfris/fish-lsp-language-clients/blob/master):
  - [ ] [Monaco](https://github.com/TypeFox/monaco-languageclient) support _(Could be used to demo project on [fish-lsp.dev](https://fish-lsp.dev))_
  - [x] [helix](https://helix-editor.com/) support
  - [x] [vscode](https://code.visualstudio.com/) support
- [x] Add [fish-lsp.dev](https://fish-lsp.dev) website
  - [ ] add monaco support -- testing lsp in web-editor
- [x] Add improved `gif` file, showcasing lsp's capabilities to README.md
- [x] include `tree-sitter-fish.wasm` in downloaded project
  - [x] build from [fork: @esdmr/tree-sitter-fish](https://npmjs.com/@esdmr/tree-sitter-fish)
  - [x] universal `*.wasm` file
- [x] [README.md](../README.md) changes:
  - [x] improve [contributing](https://github.com/ndonfris/fish-lsp#contributing) section (add authors icons)
  - [x] [license](https://github.com/ndonfris/fish-lsp#license) include only MIT
  - [ ] add `CodeAction` gifs for a section in the README (specifically the [completion GIF](https://preview.redd.it/fish-lsp-is-now-available-on-vscode-v0-zbe2mz3b00he1.gif?width=800&auto=webp&s=22211934b3ed13063cbab551fcac7e76c830d1f8) since its already recorded)
  - [ ] use a screenshot of the `# @fish-lsp-disable` feature, instead of the
        shell code version given
- [ ] Extend documentation provided via [wiki](https://github.com/ndonfris/fish-lsp/wiki)
  - [x] workflows - guide for creating new __workflows__
  - [ ] testing - guide for __writing tests__
  - [x] layout - guide for __project layout__ & __design patterns__ via mermaid charts
