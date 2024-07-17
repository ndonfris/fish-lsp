# fish-lsp(1)

> fish-lsp - A language server for the fish shell

## SYNOPSIS

`fish-lsp` [_SUBCOMMAND_|_OPTION_] [_ARGUMENT_]

## DESCRIPTION

`fish-lsp` is a language server for the fish shell. It provides IDE-like features for fish shell scripts, such as syntax checking, linting, and auto-completion.

It requires a client that supports the Language Server Protocol (LSP). For example, you can use `coc.nvim` or `nvim-lsp`.

### OPTIONS

`-v` or `--version`
Show version information and exit.

`-h` or  `--help`
Show help message and exit.

`--help-all`
show all the help information

`--help-short`
show shortened help message

`--help-man`
show manpage output

### SUBCOMMANDS

`start`
Start the language server.

  `--enable`    enable the language server features
  `--disable`   disable the language server features
  `--dump`    dump the json output of the language server features enabled after startup

`env`
show the environment variables available to the lsp

  `-c`, `--create`    create the environment variable
  `-s`, `--show`      show the environment variables
  `--no-comments`   skip outputting comments

`logger`
Access the logger

  `-s`, `--show`    show the logger and don't edit it
  `-c`, `--clear`   clear the logger
  `-d`, `--date`    write the date
  `-q`, `--quiet`   silence logging
  `--config`      show the logger config

`info`
show the build info of fish-lsp

  `--bin`             show the path of the fish-lsp executable
  `--repo`            show the path of the entire fish-lsp repo
  `--time`            show the path of the entire fish-lsp repo
  `--env`             show the env variables used
  `--lsp-version`     show the lsp version
  `--capabilities`    show the lsp capabilities
  `--man-file`        show the man file path
  `--logs-file`       show the logs.txt file path
  `--more`            show the build time of the fish-lsp executable

`url`
show a helpful url related to the fish-lsp

  `--repo`, `--git`        show the github repo
  `--npm`                show the npm package url
  `--homepage`           show the homepage
  `--contributions`      show the contributions url
  `--wiki`               show the github wiki
  `--issues`, `--report`   show the issues page
  `--discussions`        show the discussions page
  `--clients-repo`       show the clients configuration repo
  `--sources`            show a list of helpful sources

`complete`
Provide completions for the `fish-lsp`

  `--names`     show the feature names of the completions
  `--toggles`   show the feature names of the completions
  `--fish`      show fish script
  `--features`  show features

## EXAMPLES

- Start the `fish-lsp` language server, with the default configuration:

  ```fish
  >_ fish-lsp start
  ```

- Show the path to the `fish-lsp` language server binary:

  ```fish
  >_ fish-lsp complete > ~/.config/fish/completions/fish-lsp.fish
  ```

## SEE ALSO

- __website:__ _https://fish-lsp.dev/_
- __repo:__ _https://github.com/ndonfris/fish-lsp_
- __fish website:__ _https://fishshell.com/_

## AUTHOR

- Nick Donfris
