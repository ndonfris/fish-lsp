# ROADMAP

High-level overview of the project’s goals, tasks, and milestones for future
releases.

Any new ideas related to the content here are welcome.

__Sections:__

- [General Codebase Changes](#general-codebase-changes) - tasks useful for future additions
- [Server Features and Providers](#server-features-and-providers) - future general features that the server provides
- [Automation and Pipelines](#automation-and-pipelines) - __CI/CD__ or __tooling__ related to the project
- [Documentation](#documentation) - modifications for the project's documentation ([wiki](https://github.com/ndonfris/fish-lsp/wiki), [README](../README.md), [site](https://fish-lsp.dev), _etc._)

## General Codebase Changes

- [x] Refactor unused [files & data-structures](https://github.com/ndonfris/fish-lsp/blob/master/src)
- [x] Read a user's specific __configuration__ they have set
  - [x] `env_variables` could be set via [zod](https://github.com/colinhacks/zod)
  - [x] set options via cli flags, `fish-lsp start --enable ... --disable ...`
  - [ ] use builtin fish variables for generating defaults:
  `$__fish_config_dir`, `$fish_function_path`, `$__fish_user_data_dir`
    - [some documentation on the subject](file:///usr/share/doc/fish/language.html#autoloading-functions)
    - example use for functions: `fish -c 'string split " " -- $fish_function_path'`
    - `$__fish_user_data_dir` is usually `/usr/share/fish`
- [ ] Supporting [fish feature flags](https://fishshell.com/docs/current/language.html#future-feature-flags) and handling proper syntax changes

## Server Features and Providers

- [ ] Add `Diagnostics`
  - [x] add a `diagnostic queue` to store diagnostics
  - [ ] enable/disable specific features:
    - [ ] __Error__ - missing `end` to block
    - [ ] __Error__ - missing `switch/case` fall through check `case '*'` or `case \*`
    - [ ] __Warning__ - prefer `command`/`builtin` prefix for commands or builtins
    - [ ] __Warning__ - missing completions file from a `functions/<file>.fish`
    - [ ] _...add more features..._
  - [ ] write verbose tests for each new diagnostic
- [ ] Add `CodeActions`
  - [ ] Create `completions` file
  - [ ] `Quickfix` diagnostic error
  - [ ] Rename autoloaded _filename_ (for a fish `function`), that doesn't have a matching function name
  - [ ] Prefer `command` prefix for possible _aliased_ shell commands.
  - [ ] Move function in `~/.config/fish/config.fish` to it's own file, `~/.config/fish/functions/<file>.fish` and call it inline.
  - [ ] `if` statement to `and`/`or` equivalent, [combiner](https://fishshell.com/docs/current/tutorial.html#combiners-and-or-not)
- [ ] Add `CodeLens` support
  - [ ] Decide what would be useful to display
- [ ] Add `CommandExecutor` provider
- [x] Add function `SignatureHelp` provider.
    - [ ] semi complete, needs more support
- [ ] `FormatOnType` provider (useful for small files)
- [ ] Enable server via __shebang's__:
  - [ ] `#!/usr/bin/fish`
  - [ ] `#!/usr/local/bin/fish`
  - [ ] `#!/usr/bin/env fish`
- [ ] Add `DocumentHighlight` provider
- [ ] Extend symbol definitions recognized by the server:
  - [ ] variables created by `fish_opt` && `argparse` commands
  - [ ] `alias` names
  - [ ] `abbr` names
  - [ ] include [theme variables](https://fishshell.com/docs/current/interactive.html#envvar-fish_color_normal)
  - [ ] event handlers for `function _ --on-event event`
  - [ ] universal variables
- [ ] Descriptions for array indexing: `echo $PATH[-1..2]`
  - [ ] ensure array indexes are: `1 >= idx <= -1`
- [ ] `source` command use cases, for workspaces outside of default
      configurations. (The `source` command, can be used similar to import in other
      languages)
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
  - [ ] `if_statement` must be silent: `if command -s` -> `if command -sq`
  - [ ] prefer `command _` prefix for ambiguous commands
  - [ ] default case for  `switch_statement`
  - [ ] `test` _number/string_ flags from condition argument's
  - [ ] function requires returning a status number
  - [ ] `fish_add_path` instead of `set -gx PATH _`
  - [x] logger location
  - [ ] private functions need underscore prefix
  - [ ] prefer `universal` scope, or prefer `global` scope
  - [ ] prefer specific `redirect` to `/dev/null`
  - [ ] hover documentation fallback: [tldr](https://tldr.sh/), [cht.sh](https://cht.sh/), _..._
  - [ ] format specific options
  - [ ] remove showing `lsp kind` in completions list

## Automation and pipelines

- [ ] __(POTENTIALLY)__ Use [pnpm](https://pnpm.io) instead of [yarn](https://yarnpkg.com/)
- [x] Minimize `test-suite` for master branch's PR compatibility
  - [x] run via: `yarn test-hook`
- [x] Include _refactoring/tree-shaking_ help to scripts: `yarn refactor`
- [ ] Release binary downloadable files, per machine OS
  - [ ] need a build pipeline as well
  - [ ] handle scope specific dependencies
- [ ] Action for updating [fish-lsp.dev](https://github.com/ndonfris/fish-lsp.dev) documentation on new publishes
  - [x] write script for generating `fish-lsp --help` screenshot
- [ ] add action testing `fish-lsp --help` is successfully built on __os matrix__ (would be _mac_ and _unix_)

## Documentation

- [ ] Add new [editor configurations](https://github.com/ndonfris/fish-lsp-language-clients/blob/master):
  - [ ] [Monaco](https://github.com/TypeFox/monaco-languageclient) support _(Could be used to demo project on [fish-lsp.dev](https://fish-lsp.dev))_
  - [ ] [helix](https://helix-editor.com/) support
  - [ ] [vscode](https://code.visualstudio.com/) support
- [x] Add [fish-lsp.dev](https://fish-lsp.dev) website
  - [ ] add monaco support -- testing lsp in web-editor
- [x] Add improved `gif` file, showcasing lsp's capabilities to README.md
- [x] include `tree-sitter-fish.wasm` in downloaded project
  - [x] build from [fork: @esdmr/tree-sitter-fish](https://npmjs.com/@esdmr/tree-sitter-fish)
  - [x] universal `*.wasm` file
- [x] [README.md](../README.md) changes:
  - [x] improve [contributing](https://github.com/ndonfris/fish-lsp#contributing) section (add authors icons)
  - [x] [license](https://github.com/ndonfris/fish-lsp#license) include only MIT
- [ ] Extend documentation provided via [wiki](https://github.com/ndonfris/fish-lsp/wiki)
  - [ ] workflows - guide for creating new __workflows__
  - [ ] testing - guide for __writing tests__
  - [ ] layout - guide for __project layout__ & __design patterns__ via mermaid charts
