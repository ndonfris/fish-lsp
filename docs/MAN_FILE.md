# fish-lsp(1) -- A language server for the fish shell

## SYNOPSIS

`fish-lsp [OPTIONS]`
`fish-lsp [SUBCOMMAND] [OPTIONS]`

## DESCRIPTION

`fish-lsp` is a language server for the fish shell. It provides IDE-like features for fish shell scripts, such as syntax checking, linting, and auto-completion.

It requires a language client that supports the Language Server Protocol (LSP).

Some common language clients include: the builtin API for `nvim` (v0.9+), lsp-mode for `emacs`, or the fish-lsp extension for `VSCode`.

Documentation below shows usage of the `fish-lsp` command, including its subcommands and options.

## OPTIONS

`-v` or `--version`           Show version information and exit.  
`-h` or `--help`              Show help message and exit.  
`--help-all`                Show all the help information  
`--help-short`              Show shortened help message  
`--help-man`                Show manpage output  

## SUBCOMMANDS

### `start`

Start the language server.

  `--enable`                  enable the language server features  
  `--disable`                 disable the language server features  
  `--dump`                    dump the json output of the language server features enabled after startup  
  `--stdio`                   use stdin/stdout for communication (default)  
  `--node-ipc`                use node IPC for communication  
  `--socket <port>`           use TCP socket for communication  
  `--memory-limit <mb>`       set memory usage limit in MB  
  `--max-files <number>`      override the maximum number of files to analyze  

### `env`

show the environment variables available to the lsp

  `-c` or `--create`            create the environment variable  
  `-s` or `--show`              show the environment variables  
  `--show-default`            show the default values for fish-lsp env variables  
  `--only <VAR>`              only include the specified environment variables in the output  
  `--no-global`               don't use global scope when generating environment variables  
  `--no-local`                don't use local scope when generating environment variables  
  `--no-export`               don't use export flag when generating environment variables  
  `--no-comments`             skip outputting comments  
  `--confd`                   output for redirecting to conf.d/fish-lsp.fish  

### `info`

show the build info of fish-lsp

  `--bin`                     show the path of the fish-lsp executable  
  `--repo`                    show the path of the entire fish-lsp repo  
  `--time`                    show the path of the entire fish-lsp repo  
  `--env`                     show the env variables used  
  `--lsp-version`             show the lsp version  
  `--capabilities`            show the lsp capabilities  
  `--man-file`                show the man file path  
  `--log-file`                show the log file path  
  `--extra`                   show all info, including capabilities, paths, and version  
  `--time-startup`            time the startup of the fish-lsp executable  
  `--health-check`            run diagnostics and report health status  

### `url`

show a helpful url related to the fish-lsp

  `--repo` or `--git`           show the github repo  
  `--npm`                     show the npm package url  
  `--homepage`                show the homepage  
  `--contributions`           show the contributions url  
  `--wiki`                    show the github wiki  
  `--issues` or `--report`      show the issues page  
  `--discussions`             show the discussions page  
  `--clients-repo`            show the clients configuration repo  
  `--sources`                 show a list of helpful sources  

### `complete`

Provide completions for the `fish-lsp`

  `--names`                   show the feature names of the completions  
  `--toggles`                 show the feature names of the completions  
  `--fish`                    show fish script  
  `--features`                show features  
  `--env-variables`           show env variable completions  
  `--env-variable-names`      show env variable names  
  `--names-with-summary`      show the names with the summary for the completions  

## EXAMPLES

- Start the `fish-lsp` language server, with the default configuration:

  ```fish
  >_ fish-lsp start
  ```

- Show the path to the `fish-lsp` language server binary:

  ```fish
  >_ fish-lsp complete > ~/.config/fish/completions/fish-lsp.fish
  ```

- Debug the `fish-lsp` language server:

  ```fish
  >_ fish-lsp start --dump
  ```

- Show information about the `fish-lsp` language server:

  ```fish
  >_ fish-lsp info 
  ```

- Show startup timing information for the `fish-lsp` language server:

  ```fish
  >_ fish-lsp info --time-startup
  ```

- Show the environment variables available to the `fish-lsp` language server:

  ```fish
  >_ fish-lsp env --show
  ```

- Get sources related to the `fish-lsp` language server's development:

  ```fish
  >_ fish-lsp url --sources
  ```

## SEE ALSO

- __website:__ _https://fish-lsp.dev/_
- __repo:__ _https://github.com/ndonfris/fish-lsp_
- __fish website:__ _https://fishshell.com/_

## AUTHOR

- Nick Donfris
