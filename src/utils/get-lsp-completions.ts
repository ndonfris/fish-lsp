import { Command } from 'commander';
import { validHandlers } from '../config';

const AUTO_GENERATED_HEADER_STRING = `#
# AUTO GENERATED BY 'fish-lsp'
#
#   * Any command should generate the completions file
#
#      >_ fish-lsp complete > ~/.config/fish/completions/fish-lsp.fish
#      >_ fish-lsp complete --fish > ~/.config/fish/completions/fish-lsp.fish
#      >_ yarn install # from inside the 'fish-lsp' 
#
#   * You can test the completions by editing:
#
#         ~/.config/fish/completions/fish-lsp.fish 
#
#     or by using the command:
#
#      >_ fish-lsp complete
#
#     to visually check what is wrong
#
#   * For more info, try editing the generated output inside:
#
#         ~/...install_path.../fish-lsp/src/utils/get-lsp-completions.ts 
#
`;

const __fish_lsp_using_command = `
# Returns exit code of 0 if any command (argv[1..-1]) appears once, ignores flags.
function __fish_lsp_using_command
    set -l commands $argv
    set -l cmd (commandline -opc)
    if test (count $cmd) -gt 1
        set -l command_seen_once 1
        for c in $cmd[2..-1]
            switch $c
                case '-*'
                    continue
                case $commands
                    # If the command is seen more than once then return 1
                    if test $command_seen_once -eq 1
                        set command_seen_once 0
                    else
                        return 1
                    end
                case '*'
                    if test $command_seen_once -eq 0
                        return 0
                    else
                        return 1
                    end
            end
        end
        return $command_seen_once
    end
    return 1
end
`;

const noFishLspSubcommands: string = `
# fish-lsp --<TAB>
complete -c fish-lsp -n 'not __fish_lsp_using_command start logger info url complete env' -s v -l version      -d 'Show lsp version'
complete -c fish-lsp -n 'not __fish_lsp_using_command start logger info url complete env' -s h -l help         -d 'Show help information'
complete -c fish-lsp -n 'not __fish_lsp_using_command start logger info url complete env'      -l help-all     -d 'Show all help information'
complete -c fish-lsp -n 'not __fish_lsp_using_command start logger info url complete env'      -l help-short   -d 'Show short help information'
complete -c fish-lsp -n 'not __fish_lsp_using_command start logger info url complete env'      -l help-man     -d 'Show raw manpage'
`;

/**
 * Syntax for urlCompletions does not match other completions because it is not influenced
 * by receiving multiple duplicated arguments
 */
const urlCompletions: string = `# fish-lsp url --<TAB>
complete -c fish-lsp -n __fish_use_subcommand -xa url -d "url's for fish-lsp cli"
complete -c fish-lsp -n '__fish_lsp_using_command url; and not __fish_contains_opt repo'          -l repo          -d 'show git repo url'
complete -c fish-lsp -n '__fish_lsp_using_command url; and not __fish_contains_opt git'           -l git           -d 'show git repo url'
complete -c fish-lsp -n '__fish_lsp_using_command url; and not __fish_contains_opt npm'           -l npm           -d 'show npmjs.com url'
complete -c fish-lsp -n '__fish_lsp_using_command url; and not __fish_contains_opt homepage'      -l homepage      -d 'show website url'
complete -c fish-lsp -n '__fish_lsp_using_command url; and not __fish_contains_opt contributions' -l contributions -d 'show git contributions url'
complete -c fish-lsp -n '__fish_lsp_using_command url; and not __fish_contains_opt wiki'          -l wiki          -d 'show git wiki url'
complete -c fish-lsp -n '__fish_lsp_using_command url; and not __fish_contains_opt issues'        -l issues        -d 'show git issues url'
complete -c fish-lsp -n '__fish_lsp_using_command url; and not __fish_contains_opt report'        -l report        -d 'show git issues url'
complete -c fish-lsp -n '__fish_lsp_using_command url; and not __fish_contains_opt discussions'   -l discussions   -d 'show git discussions url'
complete -c fish-lsp -n '__fish_lsp_using_command url; and not __fish_contains_opt clients-repo'  -l clients-repo  -d 'show git clients-repo url'
complete -c fish-lsp -n '__fish_lsp_using_command url; and not __fish_contains_opt sources'       -l sources       -d 'show useful url list of sources'
`;

const completeCompletions: string = `# fish-lsp complete <TAB>
complete -c fish-lsp -n __fish_use_subcommand -a complete -d 'completion utils for fish-lsp cli'
complete -c fish-lsp -n '__fish_lsp_using_command complete; and not __fish_contains_opt features' -l features  -d 'show features'
complete -c fish-lsp -n '__fish_lsp_using_command complete; and not __fish_contains_opt fish'     -l fish      -d 'show completion/fish-lsp.fish'
complete -c fish-lsp -n '__fish_lsp_using_command complete; and not __fish_contains_opt names'    -l names     -d 'show feature names of completions'
complete -c fish-lsp -n '__fish_lsp_using_command complete; and not __fish_contains_opt toggles'  -l toggles   -d 'show feature names of completions'
`;

const infoCompletions: string = `# fish-lsp info --<TAB>
complete -c fish-lsp -n '__fish_lsp_using_command info; and not __fish_contains_opt bin'           -l bin            -d 'show the binary path'
complete -c fish-lsp -n '__fish_lsp_using_command info; and not __fish_contains_opt repo'          -l repo           -d 'show the repo path'
complete -c fish-lsp -n '__fish_lsp_using_command info; and not __fish_contains_opt time'          -l time           -d 'show the build-time'
complete -c fish-lsp -n '__fish_lsp_using_command info; and not __fish_contains_opt env'           -l env            -d 'show the env-variables used'
complete -c fish-lsp -n '__fish_lsp_using_command info; and not __fish_contains_opt lsp-version'   -l lsp-version    -d 'show the npm package for the lsp-version'
complete -c fish-lsp -n '__fish_lsp_using_command info; and not __fish_contains_opt capabilities'  -l capabilities   -d 'show the lsp capabilities implemented' 
complete -c fish-lsp -n '__fish_lsp_using_command info; and not __fish_contains_opt man-file'      -l man-file       -d 'show man file path'
complete -c fish-lsp -n '__fish_lsp_using_command info; and not __fish_contains_opt log-file'      -l log-file       -d 'show log file path'
complete -c fish-lsp -n '__fish_lsp_using_command info; and not __fish_contains_opt more'          -l more           -d 'show more info'
complete -c fish-lsp -n '__fish_lsp_using_command info; and not __fish_contains_opt time-startup'  -l time-startup   -d 'show startup timing info'
complete -c fish-lsp -n '__fish_lsp_using_command info; and not __fish_contains_opt check-health'  -l check-health   -d 'show the server health'
`;

// const completeCompletions: string = `# fish-lsp complete <TAB>
const envCompletions: string = `# fish-lsp env --<TAB>
complete -c fish-lsp -n __fish_use_subcommand -x -a env -d 'generate fish shell env variables to be used by lsp'
complete -c fish-lsp -n '__fish_lsp_using_command env; and not __fish_contains_opt -s s show; and not __fish_contains_opt -s c create' -s s -l show        -d 'show the current fish-lsp env variables'
complete -c fish-lsp -n '__fish_lsp_using_command env; and not __fish_contains_opt -s c create; and not __fish_contains_opt -s s show' -s c -l create      -d 'build initial fish-lsp env variables'
complete -c fish-lsp -n '__fish_lsp_using_command env; and not __fish_contains_opt no-comments'                                             -l no-comments -d 'skip outputting comments'
complete -c fish-lsp -n '__fish_lsp_using_command env; and not __fish_contains_opt no-global'                                               -l no-global   -d 'use local exports'
complete -c fish-lsp -n '__fish_lsp_using_command env; and not __fish_contains_opt no-local'                                                -l no-local    -d 'do not use local scope (pair with --no-global)'
complete -c fish-lsp -n '__fish_lsp_using_command env; and not __fish_contains_opt no-export'                                               -l no-export   -d 'do not export variables'
complete -c fish-lsp -n '__fish_lsp_using_command env; and not __fish_contains_opt confd'                                                   -l confd       -d 'output for redirect to \'conf.d/fish-lsp.fish\''
`;

const mapNames = validHandlers.join(' ');
const featuresCompletions: string = `# print all $fish_lsp_submcommands
function _fish_lsp_get_features
  printf %b\\n ${mapNames}
end
`;

// firefox-dev https://github.com/fish-shell/fish-shell/blob/master/share/completions/cjxl.fish
export function buildFishLspCompletions(commandBin: Command) {
  const subcmdStrs = commandBin.commands.map(cmd => `${cmd.name()}\\t'${cmd.summary()}'`).join('\n');
  const output: string[] = [];

  output.push(AUTO_GENERATED_HEADER_STRING);
  output.push(__fish_lsp_using_command);
  // default completions
  output.push('# disable file completions');
  output.push('complete -c fish-lsp -f', '');
  output.push(`complete -c fish-lsp -n "__fish_use_subcommand" -a "\n${subcmdStrs}\"`);
  // fish-lsp <TAB>
  output.push(noFishLspSubcommands);
  // flags for `fish-lsp start --<TAB>`
  output.push(featuresCompletions);
  output.push([
    'set __fish_lsp_subcommands start',
    '',
    '# fish_lsp start --<TAB> ',
    'complete -c fish-lsp -n \'__fish_seen_subcommand_from $__fish_lsp_subcommands\' -l dump          -d \'stop lsp & show the startup options being read\'',
    'complete -c fish-lsp -n \'__fish_seen_subcommand_from $__fish_lsp_subcommands\' -l enable        -d \'enable the startup option\'      -xa \'(_fish_lsp_get_features)\'',
    'complete -c fish-lsp -n \'__fish_seen_subcommand_from $__fish_lsp_subcommands\' -l disable       -d \'disable the startup option\'     -xa \'(_fish_lsp_get_features)\'',
    'complete -c fish-lsp -n \'__fish_seen_subcommand_from $__fish_lsp_subcommands\' -l stdio         -d \'use stdin/stdout for communication (default)\'',
    'complete -c fish-lsp -n \'__fish_seen_subcommand_from $__fish_lsp_subcommands\' -l node-ipc      -d \'use node IPC for communication\'',
    'complete -c fish-lsp -n \'__fish_seen_subcommand_from $__fish_lsp_subcommands\' -l socket        -d \'use TCP socket for communication\' -x',
    'complete -c fish-lsp -n \'__fish_seen_subcommand_from $__fish_lsp_subcommands\' -l memory-limit  -d \'set memory usage limit in MB\' -x ',
    'complete -c fish-lsp -n \'__fish_seen_subcommand_from $__fish_lsp_subcommands\' -l max-files     -d \'override the maximum number of files to analyze\' -x',
    '',
  ].join('\n'));
  // fish-lsp url --<TAB>
  output.push(urlCompletions);
  // fish-lsp complete --<TAB>
  output.push(completeCompletions);
  // fish-lsp info --<TAB>
  output.push(infoCompletions);
  // fish-lsp env --<TAB>
  output.push(envCompletions);
  // footer comment section
  output.push('');
  output.push('# built by any of the commands: ');
  output.push('# fish-lsp complete > ~/.config/fish/completions/fish-lsp.fish');
  output.push('# fish-lsp complete > $fish_complete_path[1]/fish-lsp.fish');
  output.push('# fish-lsp complete > $__fish_user_data_dir[1]/fish-lsp.fish');
  return output.join('\n');
}
