import { LspDocument } from '../src/document';
import { createFakeLspDocument } from './helpers';

/***
 * Testing helpers for creating fish workspaces with different files
 *
 * Meant to be only be used across tests in path `../test-data/*.test.ts`
 *
 *
 */

class FishLspTestWorkspace {
  constructor(public documents: LspDocument[]) { }

  uris(): string[] {
    return this.documents.map(doc => doc.uri);
  }

  getDocuments(): LspDocument[] {
    return this.documents;
  }

  get(uri: string): LspDocument | undefined {
    return this.documents.find(doc => doc.uri === uri);
  }
}

/**
 *
 * A collection of `LspDocument[]` objects.
 *
 * Not affiliated with any object defined in the `../src/` directory
 *
 * Exported definitions in this namespace do NOT actually exist on the file system, but
 * can be used to simulate different fish shell configurations.
 *
 * PROBABLE TODO:
 * Any explicit fish script defined in the `../test-data` path could be replaced with
 * a `TestWorkspace`  definition. This removes the requirement for the fish-lsp
 * package to ship any fish files.
 *
 * Current fish files in the `test-data` directory which would be included in this
 * change:
 *   - [ ] `../test-data/fish-files/`
 *   - [ ] `../test-data/workspaces/`
 *   - [ ] `../test-data/install-scripts/`
 */
export namespace TestWorkspace {
  /**
   * Fake workspace with 4 files:
   *     1) ~/.config/fish/functions/test.fish
   *     2) ~/.config/fish/functions/foo.fish
   *     3) ~/.config/fish/functions/nested.fish
   *     4) ~/.config/fish/functions/private.fish
   *
   * Workspace Notes:
   *     - DOES NOT have a config.fish file.
   *     - ONLY has functions
    *      (no special documents for: completions, conf.d, etc...)
   */
  export const functionsOnly = new FishLspTestWorkspace([
    createFakeLspDocument('functions/test.fish', [
      'function test',
      '    echo hi',
      'end',
    ].join('\n')),
    createFakeLspDocument('functions/foo.fish', [
      'function foo',
      '   test',
      'end',
    ].join('\n')),
    createFakeLspDocument('functions/nested.fish', [
      'function nested',
      '   function test',
      '       echo "inside test"',
      '   end',
      '   test',
      'end',
      '',
    ].join('\n')),
    createFakeLspDocument('functions/private.fish', [
      'function private',
      '   test',
      'end',
      'function test',
      '    echo "inside test"',
      'end',
      '',
    ].join('\n')),
  ]);

  /**
   *  Create a complete workspace with the following files:
   *      1) ~/.config/fish/config.fish
   *      2) ~/.config/fish/conf.d/abbreviations.fish
   *      3) ~/.config/fish/functions/get-os-name.fish
   *      4) ~/.config/fish/completions/get-os-name.fish
   *      5) ~/.config/fish/functions/smart-last-command.fish
   *
   *  Workspace Notes:
   *    - Has a config.fish file.
   *    - Has a conf.d directory with abbreviations.fish file.
   *    - Has a functions directory
   *    - Has a completions directory
   */
  export const completeConfig = new FishLspTestWorkspace([
    createFakeLspDocument('config.fish', [
      ' # GLOBAL VARIABLES',
      'set -gx FOO _foo_variable',
      'set -gx BAR _bar_variable',
      'set -gx OS_NAME (get-os-name)', //get-os-name is a function
      '',
      ' # PATHS',
      'fish_add_path -g /usr/local/bin',
      'fish_add_path -g /usr/bin',
      'fish_add_path -g ~/.local/bin',
      '',
      ' # ALIASES',
      'alias hello_world="echo hello world"',
      'alias cat "bat -pp"',
      'function show_aliases',
      '    alias',
      'end',
      '',
      ' # KEY BINDINGS',
      'function fish_user_key_bindings',
      '     set -l FOO "ctrl-h"',
      '     echo "binding keys: $FOO"',
      '     bind --silent -k nul complete',
      'end',
      'fish_user_key_bindings',
      '',
      '# THEMES',
      'function set_theme_variables --description "set fish theme variables"',
      '    argparse --ignore-unknown --stop-nonopt h/help n/normal s/secondary -- $argv',
      '    or return',
      '',
      '    set -gx theme_color_primary \'#815bf5\'',
      '    set -gx theme_color_secondary \'#685abc\'',
      '    set -gx theme_color_tertiary \'#685abc\'',
      '    set -gx theme_color_background \'#685abc\'',
      '    set -gx theme_color_foreground \'#ffffff\'',
      '    function show_help_msg --no-scope-shadowing',
      '        echo "Usage: set_theme_variables [-h|--help] [-n|--normal] [-s|--secondary]"',
      '        echo "  -n, --normal       Set the normal theme"',
      '        echo "  -s, --secondary    Set the secondary theme"',
      '        echo "  -h, --help         Display this help message"',
      '        echo ""',
      '        echo "  Example:"',
      '        echo ""',
      '        echo "  >_ set_theme_variables -n"',
      '        echo ""',
      '        echo "Options Seen:"',
      '        echo "  argv: $argv"',
      '        echo "  _flag_help: $_flag_help"',
      '        echo "  _flag_normal: $_flag_normal"',
      '        echo "  _flag_secondary: $_flag_secondary"',
      '        set status 1',
      '        return $status',
      '    end',
      '    function private_helper',
      '        echo "private helper"',
      '    end',
      '    if set -q _flag_help',
      '       show_help_msg',
      '       && return 1',
      '   end',
      '   if set -q _flag_normal',
      '       echo "setting normal theme"',
      '       set -gx current_theme normal',
      '       __set_theme_variables_helper',
      '   else if set -q _flag_secondary',
      '       set -gx current_theme secondary',
      '       echo "setting secondary theme"',
      '       __set_theme_variables_helper',
      '   else',
      '       echo "ERROR: no theme set!"',
      '       return 1',
      '   end',
      '   return 0',
      'end',
      '',
      'function __set_theme_variables_helper',
      '    set -gx fish_pager_color_prefix \'#815bf5\' --bold',
      '    set -gx fish_pager_color_completion \'#685abc\'',
      '    set -gx fish_pager_color_secondary_prefix \'#685abc\'',
      '    set -gx fish_pager_color_secondary_completion \'#685abc\'',
      '    set -gx fish_pager_color_secondary_description \'#685abc\'',
      '    set -gx fish_pager_color_selected_prefix white',
      '    set -gx fish_pager_color_selected_completion white',
      '    set -gx fish_pager_color_selected_description white',
      '    function __inner_helper',
      '        echo "inner helper"',
      '    end',
      '    set -gx fish_pager_color_selected_background --background=\'#685abc\'',
      'end',
      'for i in (seq 1 10)',
      '    echo "$i"',
      'end',
    ].join('\n')),
    createFakeLspDocument('conf.d/abbreviations.fish', [
      '# Abbreviations',
      '',
      'if status is-interactive',
      '',
      '   # fish clipboard',
      '   abbr -a fcc fish_clipboard_copy',
      '   abbr -a fcp fish_clipboard_paste',
      '',
      '    # ... -> ../.',
      '    function _ladder',
      '        echo ..(string replace --all . /.. (string sub -s3 $argv[1]))',
      '    end',
      '    abbr -a --regex \'\.{3,}\' --position anywhere --function _ladder -- ...',
      '',
      '   # git',
      '   abbr -a ga \'git add\'',
      '   abbr -a gc \'git commit\'',
      '   abbr -a gp \'git push\'',
      'end',
    ].join('\n')),
    createFakeLspDocument('functions/get-os-name.fish', [
      'function get-os-name',
      '',
      '    argparse h/help m/machine -- $argv',
      '    or return 0',
      '    ',
      '    if set -q _flag_help',
      '        echo "Usage: get-os-name [-h|--help] [-m|--machine]"',
      '        return 0',
      '    end',
      '    ',
      '    if set -q _flag_machine',
      '        echo (uname -m)',
      '    else',
      '        echo (uname -s)',
      '    end',
      '',
      'end',
    ].join('\n')),
    createFakeLspDocument('completions/get-os-name.fish', [
      'complete -c get-os-name -s h -l help -d \'Display this help message\'',
      'complete -c get-os-name -s m -l machine -d \'Display the machine name\'',
    ].join('\n')),
    createFakeLspDocument('functions/smart-last-command.fish', [
      'function smart-last-command --on-event fish_preexec --description \'reusable $prev_cmd event hook\'',
      '    if set -q prev_cmd && string match -eq -- prev_cmd "$history[1]"',
      '        return 0',
      '    else',
      '        echo $history[1] | read -gx -t -a prev_cmd',
      '    end',
      'end',
    ].join('\n')),
  ]);

  /**
   * FUNCTION & COMPLETION files for `foo` fish command
   *
   * Fake workspace with 2 files:
   *    1) ~/.config/fish/functions/foo.fish
   *    2) ~/.config/fish/completions/foo.fish
   */
  export const functionWithCompletion = new FishLspTestWorkspace([
    createFakeLspDocument('functions/foo.fish', [
      'function foo',
      '   argparse --max-args 1 v/version h/help \'args\' -- $argv',
      '   or return 1',

      '   if set -q _flag_version',
      '       echo "version: 1.0.0"',
      '       return 0',
      '   else if set -q _flag_help',
      '       echo "Usage: foo [-v|--version] [-h|--help]"',
      '       return 0',
      '   else',
      '       echo "args: $argv[1]"',
      '       return 0',
      '   end',
      '   echo "inside function \'foo\'',
      'end',
    ].join('\n')),
    createFakeLspDocument('completions/foo.fish', [
      'complete -c foo -s v -l version -d \'Display the version\'',
      'complete -c foo -s h -l help -d \'Display this help message\'',
      'complete -c foo -a \'(__fish_print_arguments)\' -d \'Complete arguments\'',
    ].join('\n')),
  ]);

  /**
   * ~/.config/fish/conf.d/abbreviations.fish file only.
   */
  export const confdOnly = new FishLspTestWorkspace([
    createFakeLspDocument('conf.d/abbreviations.fish', [
      '# Abbreviations',
      '',
      'if status is-interactive',
      '',
      '   # fish clipboard',
      '   abbr -a fcc fish_clipboard_copy',
      '   abbr -a fcp fish_clipboard_paste',
      '',
      '    # ... -> ../.',
      '    function _ladder',
      '        echo ..(string replace --all . /.. (string sub -s3 $argv[1]))',
      '    end',
      '    abbr -a --regex \'\.{3,}\' --position anywhere --function _ladder -- ...',
      '',
      '   # git',
      '   abbr -a ga \'git add\'',
      '   abbr -a gc \'git commit\'',
      '   abbr -a gp \'git push\'',
      '',
      'end',
    ].join('\n')),
  ]);

  export const lsComplete = new FishLspTestWorkspace([
    createFakeLspDocument('config.fish', [
      'set -gx PATH $HOME/.cargo/bin $PATH',
      'function fish_user_key_bindings',
      '    bind \cH \'backward-kill-word\' ',
      'end',
      'abbr -a -g nrt \'npm run test\'',
      'set -gx EDITOR \'nvim\'',
      'set -gx VISUAL \'nvim\'',
    ].join('\n')),
    createFakeLspDocument('completions/exa.fish', [
      '#"Fossies" - the Fresh Open Source Software Archive',
      '#Member "exa-0.10.1/completions/completions.fish" (12 Apr 2021, 4846 Bytes) of package /linux/misc/exa-0.10.1.tar.gz:',
      '#As a special service "Fossies" has tried to format the requested source page into HTML format using (guessed) Fish source code syntax highlighting (style: standard) with prefixed line numbers. Alternatively you can here view or download the uninterpreted source code file.',
      '# Meta-stuff',
      'complete -c exa -s \'v\' -l \'version\' -d "Show version of exa"',
      'complete -c exa -s \'?\' -l \'help\'    -d "Show list of command-line options"',
      '# Display options',
      'complete -c exa -s \'1\' -l \'oneline\'      -d "Display one entry per line"',
      'complete -c exa -s \'l\' -l \'long\'         -d "Display extended file metadata as a table"',
      'complete -c exa -s \'G\' -l \'grid\'         -d "Display entries in a grid"',
      'complete -c exa -s \'x\' -l \'across\'       -d "Sort the grid across, rather than downwards"',
      'complete -c exa -s \'R\' -l \'recurse\'      -d "Recurse into directories"',
      'complete -c exa -s \'T\' -l \'tree\'         -d "Recurse into directories as a tree"',
      'complete -c exa -s \'F\' -l \'classify\'     -d "Display type indicator by file names"',
      'complete -c exa        -l \'color\'        -d "When to use terminal colours"',
      'complete -c exa        -l \'colour\'       -d "When to use terminal colours"',
      'complete -c exa        -l \'color-scale\'  -d "Highlight levels of file sizes distinctly"',
      'complete -c exa        -l \'colour-scale\' -d "Highlight levels of file sizes distinctly"',
      'complete -c exa        -l \'icons\'        -d "Display icons"',
      'complete -c exa        -l \'no-icons\'     -d "Don\'t display icons"',
      '# Filtering and sorting options',
      'complete -c exa -l \'group-directories-first\' -d "Sort directories before other files"',
      'complete -c exa -l \'git-ignore\'           -d "Ignore files mentioned in \'.gitignore\'"',
      'complete -c exa -s \'a\' -l \'all\'       -d "Show hidden and \'dot\' files"',
      'complete -c exa -s \'d\' -l \'list-dirs\' -d "List directories like regular files"',
      'complete -c exa -s \'L\' -l \'level\'     -d "Limit the depth of recursion" -a "1 2 3 4 5 6 7 8 9"',
      'complete -c exa -s \'r\' -l \'reverse\'   -d "Reverse the sort order"',
      'complete -c exa -s \'s\' -l \'sort\'   -x -d "Which field to sort by" -a "',
      '    accessed\t\'Sort by file accessed time\'',
      '    age\t\'Sort by file modified time (newest first)\'',
      '    changed\t\'Sort by changed time\'',
      '    created\t\'Sort by file modified time\'',
      '    date\t\'Sort by file modified time\'',
      '    ext\t\'Sort by file extension\'',
      '    Ext\t\'Sort by file extension (uppercase first)\'',
      '    extension\t\'Sort by file extension\'',
      '    Extension\t\'Sort by file extension (uppercase first)\'',
      '    filename\t\'Sort by filename\'',
      '    Filename\t\'Sort by filename (uppercase first)\'',
      '    inode\t\'Sort by file inode\'',
      '    modified\t\'Sort by file modified time\'',
      '    name\t\'Sort by filename\'',
      '    Name\t\'Sort by filename (uppercase first)\'',
      '    newest\t\'Sort by file modified time (newest first)\'',
      '    none\t\'Do not sort files at all\'',
      '    oldest\t\'Sort by file modified time\'',
      '    size\t\'Sort by file size\'',
      '    time\t\'Sort by file modified time\'',
      '    type\t\'Sort by file type\'',
      '"',
      'complete -c exa -s \'I\' -l \'ignore-glob\' -d "Ignore files that match these glob patterns" -r',
      'complete -c exa -s \'D\' -l \'only-dirs\'   -d "List only directories"',
      '# Long view options',
      'complete -c exa -s \'b\' -l \'binary\'   -d "List file sizes with binary prefixes"',
      'complete -c exa -s \'B\' -l \'bytes\'    -d "List file sizes in bytes, without any prefixes"',
      'complete -c exa -s \'g\' -l \'group\'    -d "List each file\'s group"',
      'complete -c exa -s \'h\' -l \'header\'   -d "Add a header row to each column"',
      'complete -c exa -s \'h\' -l \'links\'    -d "List each file\'s number of hard links"',
      'complete -c exa -s \'g\' -l \'group\'    -d "List each file\'s inode number"',
      'complete -c exa -s \'S\' -l \'blocks\'   -d "List each file\'s number of filesystem blocks"',
      'complete -c exa -s \'t\' -l \'time\'  -x -d "Which timestamp field to list" -a "',
      '    modified\t\'Display modified time\'',
      '    changed\t\'Display changed time\'',
      '    accessed\t\'Display accessed time\'',
      '    created\t\'Display created time\'',
      '"',
      'complete -c exa -s \'m\' -l \'modified\'      -d "Use the modified timestamp field"',
      'complete -c exa -s \'n\' -l \'numeric\'       -d "List numeric user and group IDs."',
      'complete -c exa        -l \'changed\'       -d "Use the changed timestamp field"',
      'complete -c exa -s \'u\' -l \'accessed\'      -d "Use the accessed timestamp field"',
      'complete -c exa -s \'U\' -l \'created\'       -d "Use the created timestamp field"',
      'complete -c exa        -l \'time-style\' -x -d "How to format timestamps" -a "',
      '    default\t\'Use the default time style\'',
      '    iso\t\'Display brief ISO timestamps\'',
      '    long-iso\t\'Display longer ISO timestamps, up to the minute\'',
      '    full-iso\t\'Display full ISO timestamps, up to the nanosecond\'',
      '"',
      'complete -c exa        -l \'no-permissions\' -d "Suppress the permissions field"',
      'complete -c exa        -l \'octal-permissions\' -d "List each file\'s permission in octal format"',
      'complete -c exa        -l \'no-filesize\'    -d "Suppress the filesize field"',
      'complete -c exa        -l \'no-user\'        -d "Suppress the user field"',
      'complete -c exa        -l \'no-time\'        -d "Suppress the time field"',
      '# Optional extras',
      'complete -c exa -l \'git\' -d "List each file\'s Git status, if tracked"',
      'complete -c exa -s \'@\' -l \'extended\' -d "List each file\'s extended attributes and sizes"',
    ].join('\n')),
    createFakeLspDocument('functions/func-inner.fish', [
      'function func-inner --argument-names arg1 arg2',
      '    echo "func-inner"',
      '    function __inner',
      '        printf "\t%s" "__inner  "',
      '        printf "%s',
      '" $argv',
      '    end',
      '    if set -q arg1 && set -q arg2',
      '        __inner "arg1 and arg2 are set"',
      '        __inner "arg1: $arg1"',
      '        __inner "arg2: $arg2"',
      '    else',
      '        __inner "arg1 and arg2 are not set"',
      '    end',
      'end',
      ' #func-inner a b',
    ].join('\n')),
    createFakeLspDocument('functions/test-func.fish', [
      'function test-func',
      '    set -l count 1',
      '    for arg in $argv',
      '        __helper-test-func $count $arg',
      '        set count (math $count + 1)',
      '    end',
      'end',
      'function __helper-test-func --argument-names index arg',
      '    printf "index:$index argument:$arg',
      '"',
      'end',
      '# $ fish test-data/fish_files/functions/test-func.fish 1 2 3',
      '# test-func a b c',
    ].join('\n')),
    createFakeLspDocument('functions/test-rename-1.fish', [
      'function test-rename-1',
      '    function test-rename-inner',
      '        echo "rename this function only"',
      '    end',
      '    test-rename-inner',
      'end',
    ].join('\n')),
    createFakeLspDocument('functions/test-rename-2.fish', [
      'function test-rename-2 -d "calls test-rename-1"',
      '    test-rename-1 ',
      'end',
    ].join('\n')),
    createFakeLspDocument('functions/test-variable-renames.fish', [
      'function test-variable-renames',
      '    if set -q PATH',
      '        echo \'$PATH is set to:\'$PATH',
      '    end',
      '    echo $EDITOR',
      '    fish_user_key_bindings',
      'end',
    ].join('\n')),
    // https://github.com/fish-shell/fish-shell/pull/8145#issuecomment-885852172
    createFakeLspDocument('functions/not-visible-variable.fish', [
      'function not-visible-variable',
      '    echo "not visible inside function:" $foo',
      'end',
      'set --function --export foo bar # same with set --local',
      'not-visible-variable foo',
    ].join('\n')),
  ]);

  export const simple = new FishLspTestWorkspace([
    createFakeLspDocument('functions/all_variable_def_types.fish', [
      'echo "hello world" | read -l a',
      'for i in (seq 1 10)',
      '    echo "hello world: $i"',
      'end',
      'function hello --description "prints hello world" -a  b c d --inherit-variable PATH',
      '    echo "hello world: $b $c $d"',
      '    echo "$argv"',
      '    echo "$PATH"',
      'end',
      'set --global e "$a$b"',
      'set --universal f "$b$c"',
    ].join('\n')),
    createFakeLspDocument('functions/for_var.fish', [
      '# counts down in reverse',
      'for i in (seq 1 10)[-1..1]',
      '    echo $i',
      'end',
      'echo $i; #i should equal 1 -> @see `man for`',
    ].join('\n')),
    createFakeLspDocument('functions/func_a.fish', [
      'function func_a --description "this is func_a"',
      '    set -l a a a',
      '    set -l a (printf "%s',
      '" a a a | string join \'',
      '\')',
      '    printf "%s" a a a | string unescape',
      'end',
      '#switch "$argv"; case "*"; end',
      '#switch $argv; case *;end',
      '#(program',
      '# (command name: (word) argument: (double_quote_string) redirect: (file_redirect operator: (direction) destination: (word)))',
      '# (command name: (word))',
      '#)',
    ].join('\n')),
    createFakeLspDocument('functions/func_abc.fish', [
      'function func_a',
      '    set -l a a a',
      'end',
      'function func_b',
      '    #set -l b bb bb',
      '    set -U b bb',
      'end',
      '# func_c -> c',
      'function func_c',
      '    set -l c ccc ccc',
      'end',
    ].join('\n')),
    createFakeLspDocument('functions/function_variable_def.fish', [
      'function simple_function --argument-names hello world',
      '    printf "$hello $world"',
      'end',
    ].join('\n')),
    createFakeLspDocument('functions/global_vs_local.fish', [
      '########## PROGRAM',
      'set --global testvar "global symbol"',
      'echo $testvar',
      'function _test ',
      '    set --local testvar "local symbol"',
      '    echo $testvar',
      '    set --global testvar "inner global symbol"',
      'end',
      '_test',
      'set testvar "global symbol"',
      'echo $testvar',
    ].join('\n')),
    createFakeLspDocument('functions/inner_function.fish', [
      'function outer',
      '    function inner ',
      '        set --local a "a"',
      '        set --local a "aa"',
      '        set --local a "aaa"       ',
      '    end',
      '    set a "A" ',
      'end',
      'function _helper',
      '    set --function b "b"',
      'end',
    ].join('\n')),
    createFakeLspDocument('functions/is_chained_return.fish', [
      'begin;',
      '    return true; and',
      '    echo "chained 1st"',
      '    and echo "chained 2nd";',
      '    or  echo "chained 3rd";',
      '    echo "outside chained";',
      'end;',
    ].join('\n')),
    createFakeLspDocument('functions/multiple_broken_scopes.fish', [
      'function multiple_broken_scopes',
      '    set -l var "$argv"',
      '    if test "$var" = hello',
      '        echo hello',
      '        or echo "bad 1"',
      '        and echo "bad 2"',
      '        or echo "bad 3"; ',
      '        return 0;',
      '    else if test "$var" = world',
      '        echo $var',
      '        return 0',
      '    else',
      '        echo a',
      '        return 0',
      '    end',
      '    set -l var "$argv"',
      '    if test -z "$argv"',
      '        if test -z \'a\'',
      '            return 0',
      '        else',
      '            return 0',
      '        end',
      '        echo "hi"',
      '        return 0',
      '    else ',
      '        return 0',
      '    end',
      '    echo "hi"',
      'end',
    ].join('\n')),
    createFakeLspDocument('functions/set_var.fish', [
      'set var "hello world"',
    ].join('\n')),
    createFakeLspDocument('functions/simple_function.fish', [
      '# prints hello world twice',
      'function simple_function',
      '    printf "hello world',
      '"',
      '    echo "hello world"',
      'end',
    ].join('\n')),
    createFakeLspDocument('functions/symbols.fish', [
      'set -l arg_two \'seen one time\' ',
      'function func_a',
      '    set -l arg_one $argv[1]',
      '    for i in (seq 1 10)',
      '        echo "$i: $arg_one"',
      '    end',
      'end',
      'set -l arg_two \'seen two times\'',
      'function func_b',
      '    for i in (seq 1 10)',
      '        func_a $argv',
      '    end',
      'end',
      'set -l arg_two \'seen three times\'',
      'function func_c --argument-names arg_one',
      '    for i in (seq 1 10)',
      '        func_a $arg_one',
      '         ',
      '    end',
      'end',
      'func_b $arg_two',
    ].join('\n')),
  ]);

}

// Generated the workspaces with the following `fish` script:
//
//```fish
// # `cd ../test-data/$workspace_name/` to the directory where the fish files are located
//
//
// function printFakeLspDocuments -a file
//     set uri (string split -m1 -f2 '../' -- "$file"; or string split -m1 -f2 './' -- "$file"; or echo "$file");
//     echo -n "createFakeLspDocument('functions/$uri',"
//     echo '['
//     for line in (cat $file | string split '\n' -n )
//         echo "`$line`,"
//     end
//     echo '].join(\'\n\')),'
// end
//
// begin
//     echo 'new FishLspTestWorkspace(['
//     for file in ./**.fish
//         printFakeLspDocuments $file
//     end;
//     echo '])';
// end
//```