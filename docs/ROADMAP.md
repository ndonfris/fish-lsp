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

- [ ] abbr parser to build expandable `CompletionItem` snippets that insert the cursor in the `abbr --set-cursor=%` output.
  - Normal case without `--set-cursor` would just directly insert the abbr
    and add more `CompletionItem.commitCharacters` to these specific items.
  - Special case using `--set-cursor` would get the output of the abbr,
    and then replace the `--set-cursor=%` token with the snippet expansion
    token. Lots to consider here -- do we read this from a subshell?
    Performance could be a concern here if we do use a subshell.
- [ ] Add code actions to replace absolute paths w/ variable that points to the previous location
  - [ ] inefficient path diagnostics 
  _(inefficient meaning, things like absolute paths that could be replaced with relative paths, or
  variables that point to the same location)_
  - [ ] checking if a symbol is a path (could be `isString()`, `isConcatenation()`, `...`). 
        Currently considering a simple check for `/` in the `node.text`, to solve this
- [ ] make `__fish_contains_opt opt` be considered as a `argparse` reference to the variable `opt`
  - [ ] `__fish_contains_opt -s o opt` would match the `argparse o/opt` definition in the matching function/completion file
  - [ ] `complete -c cmd -n '__fish_contains_opt opt'` would be a common usage
- [ ] add support for hovering a `~/some/file/path` and show the expanded result
  - [ ] add info diagnostics for replacing absolute paths with expandable paths
  - [ ] allow disabling this feature
- [ ] add support for renaming ALL autoloaded files (currently requires atleast two code-actions to be used)
  - [ ] when a code-action changes an autoloaded function, also rename its completions file, and vice versa
- [ ] Add virtual document support for `go-to-definition` of a manpage
- [ ] Server Command to display `fish_config` in a browser
- [ ] add headless mode for the server (allows for using the server via the commandline, without opening any client).
  - [ ] for example, `fish-lsp headless --code-action='generate.completions' --file=~/.config/fish/functions/foo.fish`
        would create a completions file for the `foo.fish` function, if it has
        an argparse in its body.
    - [ ] `fish-lsp headless --show-tree --file=~/.config/fish/functions/foo.fish`
           would show the client tree of the file
    - [ ] `fish-lsp headless --get-references --file=~/.config/fish/functions/foo.fish --function=foo`
           would show the references for the symbol defined in the file with the
           name `foo`
      - [ ] allow passing options for which scope to match the definition symbol, to search for specific references
        - [ ] `--scope=local` would only match references in the current file
        - [ ] `--scope=global` would match references in the current file and all files in the workspace
    - [ ] `fish-lsp headless --show-tree --file=~/.config/fish/functions/foo.fish --scope=global`
          would show all global symbols in the file 
    - [ ] `fish-lsp headless --get-references --file=~/.config/fish/functions/foo.fish --function=foo --scope=global`
          would show all references to the symbol `foo` in the file and all files
          in the workspace
    - [ ] `fish-lsp headless --diagnostics` would show all diagnostics for the
          current workspace, or a specific file if passed with `--file=~/.config/fish/functions/foo.fish`
    - [ ] `fish-lsp headless --workspace-symbols` would show all symbols in the
          current workspace, or a specific file if passed with `--file=~/.config/fish/functions/foo.fish`
    - [ ] add completions for using the headless mode, so that the user does not
          have to remember how to use each subcommand
- [ ] add support for a document to contain changes to the server's settings, and the server to update its settings based on the document changes
  - [ ] cli command to generate the default settings file with default values
  - [ ] cli command to show the current settings file of the directory `$PWD`
  - [ ] server command to create a new settings file in the current workspace
  - [ ] server command to update the server's settings file in the current workspace 
  - [ ] server command to show the current server's settings file inside of the current workspace
  - [ ] create a schema for the server's settings file, so that a json-lsp client can validate the settings file and provide completions
  - [ ] allow the user to specify custom fish file paths in the current workspace that should
        be treated like they were autoloaded files
  - [ ] consider allowing converting the server's settings file to its equivalent fish source code
  - [ ] allow any code-action that uses `# @fish-lsp-disable` to also be specified
        in the server's settings file. __(NEED TO THINK ABOUT BEST WAY TO STORE THIS)__
- [ ] allow function definitions with `--no-scope-shadowing` or other flags that
      would change how the caller's scope is used, to be recognized as
      references relative to the request position.

    ```fish
    function foo
        set -l baz 1
        #      ^^^---------- getReferences() to this variable [TOTAL: 2] (CASE 1)
        bar
        # since we call bar from the same scope as the getReferences() definition symbol
        # and bar has the `--no-scope-shadowing` flag, the reference to `baz` would be
        # considered a matching reference to the `baz` variable in the `foo` function
    end
    function bar --no-scope-shadowing
        echo $baz
        #     ^^^----------- getReferences() to this variable [TOTAL: 0] (CASE 2)
    end
    # Summary: 
    # 
    # When baz references are requested from inside the foo function,
    # we check all commands called inside of the foo function. if any of them
    # inherit the scope of the foo function, add the local references from the 
    # called function to the references of the foo function.
    #
    # 
    # When we check the references for `baz` inside of the `bar` function, we
    # only show references that are used inside of the `bar` function.
    ```
    > NOTE: You could also try to find all references to the parent function and
    >       then add the caller scopes to the references of the parent function.
    >       This way, Case 2 would include the references to `$baz` in `foo`
- [ ] allow functions with `--argument-names` to provide inlay hints for the
      arguments that are passed into the function calls, so that named arguments
      are shown in the client as inlay hints.
- [x] add support for expanding `concatenation` SyntaxNode: definitions, references and hovers
  ```fish
  for opt in fish_lsp_{enabled_handlers,disabled_handlers,commit_characters,log_file,log_level,all_indexed_paths,modifiable_paths,diagnostic_disable_error_codes,enable_experimental_diagnostics,max_background_files,show_client_popups,single_workspace_support}
  #          ^^^^^^^^^^---------------------- Hovering here would show the expansion 
      if not contains -- $opt $features_to_skip
          echo -e "$opt\t'fish-lsp env variable'"
      end
  end
  ```
- [ ] Inline Value provider (debugger for current line of script)
- [ ] Allow formatting of files without using `fish_indent` command
- [ ] Write server handler for [`Call Hierarchy` requests](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#callHierarchy_incomingCalls)
- [ ] Allow server to support registering a capability for the client to check
      the `type -ap` a command under the current location.
- [ ] Support options to enable from client configuration
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
- [ ] Add server handler for `onSemanticToken` support
- [ ] Add server handler for [`textDocument/publishDiagnostics`](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_publishDiagnostics) to allow project wide diagnostics 
- [ ] Add code action to convert shebangs
  - [ ] `#!/usr/bin/fish` to `#!/usr/bin/env fish`
  - [ ] `#!/usr/local/bin/fish` to `#!/usr/bin/env fish`
- [x] add hover support to end stdin token `--`
- [x] add code-action to convert external shell commands to fish builtins (where applicable)
- [x] add `fish-lsp info --time-startup --use-workspace $PWD` support, to time how long it takes to start the server with only the current workspace
- [ ] consider if exported variables should not be included in the unused `FishSymbol[]` reported
      by diagnostic `4004`

## General Codebase Changes

- [x] Add binary releases for common platforms
  - [x] `fish-lsp` binary for `macOS`
  - [x] `fish-lsp` binary for `Linux`
  - [ ] `fish-lsp` binary for `Windows`
- [x] Improve filtering of tokens between renaming and referencing (tricky issue because
      the [lsif.dev](https://lsif.dev) specification does not support renaming
      symbols that don't have exact matching names 
  - [x] `argparse h/help` vs `$_flag_{h,help}` vs `set -lq _flag_help` vs
         `complete -s h -l help` vs `cmd --help`/`cmd -h`
  - [x] `set -gx fish_lsp_*` vs `$_fish_lsp_{var_name}`
  - [x] `alias foo='bar'` vs `foo` vs `function foo --wraps=bar;...end;`
  - [x] `function baz --wraps=foo` vs `foo` vs `function foo; end;`
  - [x] `complete -n 'foo' ...` vs `function foo; end;`
  - [x] `bind ... foo` vs `bind ... 'foo'` vs `function foo; end;`
  - [x] `abbr ... --function foo` vs `function foo; end;` vs `abbr ... foo`
- [x] update `src/references.ts` w/ a `getReferences()` function that supports
      passing general behavior changes
- [x] Add `$__fish_**` auto-loaded environment variables to the server's startup
      configuration. An example auto-loaded variable would be `$__fish_config_dir`
- [x] Improve parsing of specific DocumentSymbols (now `FishSymbol`) by using
      more verbose rules for excluding certain tokens from `web-tree-sitter`
- [x] Add better workspace support for non-standard/small fish workspaces. 
  **THE `server` FILE LIKELY NEEDS [workspace handlers](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#workspace_workspaceFolders)**
  - [x] Supporting `/tmp/*.fish` buffers from things like `edit_command_buffer`/`alt-e`
  - [ ] Supporting `fisher` workspaces (consider a workspace like `~/repo/fisher-plugin`, as its own workspace without `$fish_lps_all_indexed_paths`)
      > *NOTE:* `fish_lsp_single_workspace_support` was an attempt at specifying that
      the user has opted into this feature
  - [x] Supporting sourced files outside of workspace, and adding them to the
        workspace
- [x] Go-to-Definition && Hover support for `source some_file.fish` command
- [ ] Improving completions for `set -gx fish_lsp_*` env variables
    - [ ] adding better hover documentation to `fish_lsp_*` env variables, using
      the `options` [property](https://github.com/ndonfris/fish-lsp/blob/feat/seperating-symbols-parsing/src/snippets/fishlspEnvVariables.json)
- [x] [Comparing](https://github.com/ndonfris/fish-lsp/tree/feat/seperating-symbols-parsing/src/parsing) already generated `complete -c cmd -s _ -l _` [completions](https://github.com/ndonfris/fish-lsp/blob/feat/seperating-symbols-parsing/src/parsing/complete.ts) to the
      a [function](https://github.com/ndonfris/fish-lsp/blob/feat/seperating-symbols-parsing/src/parsing/argparse.ts) with an `argparse` child definition, so that duplicate
      completions are not generated
  - [x] `argparse 'n/name=' -- $argv` command could generate
        `complete -c cmd -s n -l name -a ' '` - Key difference being the `-a` flag is outputted
        There is also the `-x` and `-r` flags that could be used.
- [x] General plumbing
  - [x] Add more test coverage for heavily used files.
  - [x] Remove unused/deprecated files and/or functions
- [x] Consider allowing the user to specify configuring the [`fish_indent` command](https://fishshell.com/docs/current/cmds/fish_indent.html) behavior
  - [x] `fish v3.7.1` to ` fish v4.0.0` changes `fish_indent` behavior specifically for `;` characters to be replaced with `\n`,
        creating potentially unwanted formatting changes
  - [ ] Allow option to specify either `fish_indent --only-indent` or `fish_indent` for formatting a file.
- [ ] Update docs for using `initializationParams` in the client configuration
- [x] remove `fish-lsp logger`
  - [x] remove `fish-lsp logger` from the `src/cli.ts` file
  - [x] remove `fish-lsp logger` from the completions 
  - [x] remove `fish-lsp logger` utilities from the `src/logger.ts` file
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

- [x] Add `src/parsing/emit.ts` file for emitting a `FishSymbol` to call
      a `Function`. This would disable diagnostics causing false positives for 
      users who like to use a lot of event handlers in their fish config
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
  - [ ] color theme variables as well
- [x] `FormatOnType` provider (useful for small files)
  - [x] add to `config`
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
<!-- - [ ] add headless commandline mode `fish-lsp headless` -->
<!--   - [x] an example of what would be included here is things like: `fish-lsp info --time-startup` (move this to `headless subcommand`) -->
<!--   - [ ] `--code-action generate-completions FILE` use the `fish-lsp` server to generate -->
<!--         completions for a file, and then write them to the file. -->
<!--   - [ ] `--code-action fix-all FILE` use the `fish-lsp` server to generate completions for a file, and then write them to the file. -->
<!--   - [ ] `--lint FILE` show diagnostics for a file -->
<!--   - [ ] `--show-symbols-tree FILE` output a nested symbols tree of definitions for a file -->
<!--   - [ ] `--references FILE symbol_name` show all references to a symbol in a file -->
<!--   - [ ] `--diagnostics FILE` show all diagnostic warnings for a file -->
<!---->
<!--     > *NOTE:* this feature essentially would allow users to use the server as a -->
<!--     cli utility, without needing to be in their client. -->


## Automation and pipelines

- [x] __(POTENTIALLY)__ Use [pnpm](https://pnpm.io) instead of [yarn](https://yarnpkg.com/)
- [x] Minimize `test-suite` for master branch's PR compatibility
  - [x] run via: `yarn test-hook`
- [x] Include _refactoring/tree-shaking_ help to scripts: `yarn refactor`
- [ ] Release binary downloadable files, per machine OS
  - [ ] need a build pipeline as well
  - [ ] handle scope specific dependencies
  > NOTE: used bun to complete this, but the binary files are huge so it
  currently
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
  - [x] use a screenshot of the `# @fish-lsp-disable` feature, instead of the
        shell code version given
  - [x] add go-to implementation to README.md
- [ ] Extend documentation provided via [wiki](https://github.com/ndonfris/fish-lsp/wiki)
  - [x] workflows - guide for creating new __workflows__
  - [ ] testing - guide for __writing tests__
  - [x] layout - guide for __project layout__ & __design patterns__ via mermaid charts
