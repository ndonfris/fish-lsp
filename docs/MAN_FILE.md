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

`min` or `bare`
Start the language server without any language-specific features.

`logger`
Access the logger

`info`
show the build info of fish-lsp

`url`
show a helpful url related to the fish-lsp

`complete`
Provide completions for the `fish-lsp`

## EXAMPLES

 • Start the `fish-lsp` language server, with the default configuration:

  ```fish
  >_ fish-lsp start
  ```

• Start the `fish-lsp` language server, with the bare minimum configuration:

  ```fish
  >_ fish-lsp bare --enable hover
  ```

• Show the path to the `fish-lsp` language server binary:

  ```fish
  >_ fish-lsp complete > ~/.config/fish/completions/fish-lsp.fish
  ```

## SEE ALSO

  • __website:__ _https://fish-lsp.dev/_
  • __repo:__ _https://github.com/ndonfris/fish-lsp_
  • __fish website:__ _https://fishshell.com/_

## AUTHOR

- Nick Donfris
