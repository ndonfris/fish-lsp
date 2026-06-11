# fish-lsp(1) -- A language server for the fish shell

<a id="synopsis"></a>
## SYNOPSIS

```
fish-lsp [-v | --version] [-h | --help] [--help-all] [--help-short]
         [--help-man]
fish-lsp start [--enable | --disable] [--dump]
               [--stdio | --node-ipc | --socket PORT]
               [--memory-limit MB] [--max-files NUMBER] [--web]
fish-lsp env [-c | --create] [-s | --show] [--show-default]
             [--only VAR] [--no-global] [--no-local] [--no-export]
             [--no-comments] [--confd] [--json]
fish-lsp info [--bin] [--path] [--build-time] [--build-type]
              [-v | --version] [--lsp-version] [--capabilities]
              [--man-file] [--log-file] [--show] [--short] [--json]
              [--extra] [--verbose] [--check-health] [--health-check]
              [--time-startup] [--time-only] [--use-workspace PATH]
              [--no-warning] [--show-files] [--dump-symbol-tree FILE]
              [--dump-parse-tree FILE] [--dump-semantic-tokens FILE]
              [--no-color] [--no-icons] [--source-maps] [--check]
              [--status]
fish-lsp url [--repo | --git] [--npm] [--homepage]
             [--contributions] [--wiki] [--issues | --report]
             [--discussions] [--clients-repo] [--sources]
fish-lsp complete [--names] [--toggles] [--fish] [--features]
                  [--env-variables] [--env-variable-names]
                  [--names-with-summary] [--abbreviations]
```

<a id="description"></a>
## DESCRIPTION

`fish-lsp` is a [Language Server Protocol](https://lsif.dev) (LSP) implementation for the fish shell. It brings IDE-like features to fish scripts in any editor that supports the protocol, including completions, hover documentation, signature help, diagnostics, goto definition, find references, rename, document and workspace symbols, and formatting.

The server is not run directly by the user. A language client starts it and communicates over `stdio` (the default), a TCP socket, or node IPC. Common clients include the built-in LSP API in `nvim` (v0.9+), `lsp-mode` for `emacs`, and the fish-lsp extension for `VSCode`.

Server behavior is configured through the `fish_lsp_*` environment variables, which can be generated with `fish-lsp env`. Any command flag overrides its corresponding environment variable for that invocation.

The following subcommands are available:

- `start` — start the language server
- `env` — generate the `fish_lsp_*` environment variables
- `info` — show build, health, and debugging information
- `url` — print helpful project URLs
- `complete` — generate completions for the `fish-lsp` command

<a id="options"></a>
## OPTIONS  
  
`-v`, `--version`                Show version information and exit.  
`-h`, `--help`                   Show help message and exit.  
`--help-all`                     Show all the help information  
`--help-short`                   Show shortened help message  
`--help-man`                     Show manpage output  

<a id="start"></a>
## START SUBCOMMAND

```
fish-lsp start [--enable | --disable] [--dump]
               [--stdio | --node-ipc | --socket PORT]
               [--memory-limit MB] [--max-files NUMBER] [--web]
```

start the language server  
  
  `--enable [HANDLER...]`          enable the language server features  
  `--disable [HANDLER...]`         disable the language server features  
  `--dump`                         dump the json output of the language server features enabled after startup  
  `--stdio`                        use stdin/stdout for communication (default)  
  `--node-ipc`                     use node IPC for communication  
  `--socket <port>`                use TCP socket for communication  
  `--memory-limit <mb>`            set memory usage limit in MB  
  `--max-files <number>`           override the maximum number of files to analyze  
  `--web`                          start server in web mode used for [https://fish-lsp.dev/playground](https://fish-lsp.dev/playground)  

<a id="start-examples"></a>
### Examples

- Start the `fish-lsp` language server, with the default configuration:  

  ```fish
  >_ fish-lsp start
  ```

- Debug the `fish-lsp` language server by dumping the enabled features after startup:  

  ```fish
  >_ fish-lsp start --dump
  ```

- Start the `fish-lsp` language server with certain features disabled

  ```fish
  >_ fish-lsp start --disable diagnostic complete 
  ```

<a id="env"></a>
## ENV SUBCOMMAND

```
fish-lsp env [-c | --create] [-s | --show] [--show-default]
             [--only VAR] [--no-global] [--no-local] [--no-export]
             [--no-comments] [--confd] [--json]
```

show the environment variables available to the lsp  
  
  `-c`, `--create`                 create the environment variable  
  `-s`, `--show`                   show the environment variables  
  `--show-default`                 show the default values for fish-lsp env variables  
  `--only <VAR>`                   only include the specified environment variables in the output  
  `--no-global`                    don't use global scope when generating environment variables  
  `--no-local`                     don't use local scope when generating environment variables  
  `--no-export`                    don't use export flag when generating environment variables  
  `--no-comments`                  skip outputting comments  
  `--confd`                        output for redirecting to conf.d/fish-lsp.fish  
  `--json`                         output `fish_lsp_*` initialization variables as JSON object (for vscode `settings.json`)  

<a id="env-examples"></a>
### Examples

- Show the environment variables available to the `fish-lsp` language server:  

  ```fish
  >_ fish-lsp env --show
  ```

- Show the default values for specific environment variables used by the `fish-lsp` language server:  

  ```fish
  >_ fish-lsp env --show-default --only fish_lsp_all_indexed_paths,fish_lsp_max_background_files --no-comments
  ```

<a id="info"></a>
## INFO SUBCOMMAND

```
fish-lsp info [--bin] [--path] [--build-time] [--build-type]
              [-v | --version] [--lsp-version] [--capabilities]
              [--man-file] [--log-file] [--show] [--short] [--json]
              [--extra] [--verbose] [--check-health] [--health-check]
              [--time-startup] [--time-only] [--use-workspace PATH]
              [--no-warning] [--show-files] [--dump-symbol-tree FILE]
              [--dump-parse-tree FILE] [--dump-semantic-tokens FILE]
              [--no-color] [--no-icons] [--source-maps] [--check]
              [--status]
```

show the build info of fish-lsp  
  
  `--bin`                          show the path of the fish-lsp executable  
  `--path`                         show the path of the entire fish-lsp installation  
  `--build-time`                   show the path of the entire fish-lsp repo  
  `--build-type`                   show the build type of the command  
  `-v`, `--version`                show the lsp version  
  `--lsp-version`                  show the vscode-languageserver version  
  `--capabilities`                 show the lsp capabilities  
  `--man-file`                     show the man file path  
  `--log-file`                     show the log file path  
  `--show`                         show the man/log file contents (needs to be paired with `--log-file` or `--man-file`)  
  `--short`                        display small amount of info (alias for `--version --build-type --build-time --lsp-version`)  
  `--json`                         display the info as JSON (e.g., `fish-lsp info --short --json`)
  `--extra`                        show debugging server info (capabilities, paths, version, etc.)  
  `--verbose`                      show debugging server info (capabilities, paths, version, etc.)  
  `--check-health`                 run diagnostics and report health status  
  `--health-check`                 run diagnostics and report health status  
  `--time-startup`                 time the startup of the fish-lsp executable  
  `--time-only`                    show brief summary of the startup timing  
  `--use-workspace <PATH>`         use the workspace at the specified directory path when `fish-lsp info --time-startup` is used  
  `--no-warning`                   disable message in the `fish-lsp info --time-startup` output  
  `--show-files`                   show the files that were indexed during startup when `fish-lsp info --time-startup` is used  
  `--dump-symbol-tree <FILE>`      show the fish-lsp definition symbol tree for the specified file  
  `--dump-parse-tree <FILE>`       show the tree-sitter AST for the specified file  
  `--dump-semantic-tokens <FILE>`  show the semantic-tokens for the specified file  
  `--no-color`                     disable color output from `--dump-*` output  
  `--no-icons`                     disable icon usage in output from `fish-lsp info --dump-symbol-tree`  
  `--source-maps`                  show the source-maps  
  `--check`                        used in combination with `--source-maps`, verifies source-maps are working by throwing an error  
  `--status`                       used in combination with `--source-maps`, shows status of source-maps loading  

<a id="info-examples"></a>
### Examples

- Show information about the `fish-lsp` language server:  

  ```fish
  >_ fish-lsp info
  ```

- Show all the available information about the `fish-lsp` language server:  

  ```fish
  >_ fish-lsp info --verbose
  ```

- Show startup timing information for the `fish-lsp` language server:  

  ```fish
  >_ fish-lsp info --time-startup
  ```

- Show startup timing information for the `fish-lsp` language server for a specific workspace:  

  ```fish
  >_ fish-lsp info --time-startup --use-workspace ~/.config/fish --no-warning
  ```

- Preform a health check on the `fish-lsp` language server:  

  ```fish
  >_ fish-lsp info --check-health
  ```

- Show the tree-sitter-fish parse tree for the input:  

  ```fish
  >_ cat ~/.config/fish/config.fish | fish-lsp info --dump-parse-tree
  ```

- Show the definition symbol tree for a specific file:  

  ```fish
  >_ fish-lsp info --dump-symbol-tree ~/.config/fish/config.fish
  ```

- Show the semantic tokens for a specific file (read from `stdin`):  

  ```fish
  >_ cat $__fish_data_dir/config.fish | fish-lsp info --dump-semantic-tokens
  ```

<a id="url"></a>
## URL SUBCOMMAND

```
fish-lsp url [--repo | --git] [--npm] [--homepage]
             [--contributions] [--wiki] [--issues | --report]
             [--discussions] [--clients-repo] [--sources]
```

show a helpful url related to the fish-lsp  
  
  `--repo`, `--git`                show the github repo  
  `--npm`                          show the npm package url  
  `--homepage`                     show the homepage  
  `--contributions`                show the contributions url  
  `--wiki`                         show the github wiki  
  `--issues`, `--report`           show the issues page  
  `--discussions`                  show the discussions page  
  `--clients-repo`                 show the clients configuration repo  
  `--sources`                      show a list of helpful sources  

<a id="url-examples"></a>
### Examples

- Get sources related to the `fish-lsp` language server's development:  

  ```fish
  >_ fish-lsp url --sources
  ```

<a id="complete"></a>
## COMPLETE SUBCOMMAND

```
fish-lsp complete [--names] [--toggles] [--fish] [--features]
                  [--env-variables] [--env-variable-names]
                  [--names-with-summary] [--abbreviations]
```

Provide completions for the `fish-lsp`  
  
  `--names`                        show the feature names of the completions  
  `--toggles`                      show the feature names of the completions  
  `--fish`                         show fish script  
  `--features`                     show features  
  `--env-variables`                show env variable completions  
  `--env-variable-names`           show env variable names  
  `--names-with-summary`           show the names with the summary for the completions  
  `--abbreviations`                show the 'fish-lsp' subcommand abbreviations  

<a id="complete-examples"></a>
### Examples

- Generate the completions for the `fish-lsp` language server binary:  

  ```fish
  >_ fish-lsp complete > ~/.config/fish/completions/fish-lsp.fish
  ```

- Generate the abbreviations for the `fish-lsp` language server binary:  

  ```fish
  >_ fish-lsp complete --abbreviations | source
  ```

<a id="see-also"></a>
## SEE ALSO

- **website:** <https://fish-lsp.dev>
- **repo:** <https://github.com/ndonfris/fish-lsp>
- **fish website:** <https://fishshell.com>

<a id="author"></a>
## AUTHOR

- Nick Donfris
