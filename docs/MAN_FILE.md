# fish-lsp(1)

> fish-lsp - A language server for the fish shell

## SYNOPSIS

`fish-lsp` [_SUBCOMMAND_|_OPTION_] [_ARGUMENT_]

## DESCRIPTION

`fish-lsp` is a language server for the fish shell. It provides IDE-like features for fish shell scripts, such as syntax checking, linting, and auto-completion.

It requires a client that supports the Language Server Protocol (LSP). For example, you can use `coc.nvim` or `nvim-lsp`.

### OPTIONS

`-h` or  `--help`
Show help message and exit.

`-v` or `--version`
Show version information and exit.

### SUBCOMMANDS

`start`
Start the language server.

`min` or `bare`
Start the language server without any language-specific features.

`info`
show the build info of fish-lsp

`url`
show a helpful url related to the fish-lsp

`complete`
Provide completions for the `fish-lsp`

`help`
Show help message and exit.

## EXAMPLES

Start the `fish-lsp` language server, with the default configuration:

```sh
> fish-lsp start
```

Start the `fish-lsp` language server, with the bare minimum configuration:

```sh
> fish-lsp bare --enable hover
```

Show the path to the `fish-lsp` language server binary:

```sh
> fish-lsp complete > ~/.config/fish/completions/fish-lsp.fish
```

## SEE ALSO

__website:__ _https://fish-lsp.dev/_

__repo:__ _https://github.com/ndonfris/fish-lsp_

__fish website:__ _https://fishshell.com/_

## AUTHOR

- Nick Donfris
