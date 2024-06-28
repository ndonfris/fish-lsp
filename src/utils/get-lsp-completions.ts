import { Command } from 'commander';
// import { ConfigMap } from './configuration-manager';
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


/**
 * Syntax for urlCompletions does not match other completions because it is not influenced
 * by recieving multiple duplicated arguments
 */
const urlCompletions: string = `# fish-lsp url --<TAB>
complete -c fish-lsp -n "__fish_seen_subcommand_from url" -a "
--repo\t'show git url'
--git\t'show git url'
--npm\t'show npm url'
--homepage\t'show homepage url'
--contributions\t'show git contributions url'
--wiki\t'show git wiki url'
--issues\t'show git issues url'
--report\t'show git issues url'
--discussions\t'show git discussions url'
--clients-repo\t'show git clients-repo url'
--sources\t'show useful list of sources'"
`;

const completeCompletions: string = `# fish-lsp complete <TAB>
complete -c fish-lsp -n __fish_use_subcommand -a complete -d 'completion utils for fish-lsp cli'
complete -c fish-lsp -n '__fish_lsp_using_command complete; and not __fish_contains_opt features' -l features -d 'show features'
complete -c fish-lsp -n '__fish_lsp_using_command complete; and not __fish_contains_opt fish'     -l fish     -d 'show completion/fish-lsp.fish'
complete -c fish-lsp -n '__fish_lsp_using_command complete; and not __fish_contains_opt names'    -l names    -d 'show feature names of completions'
complete -c fish-lsp -n '__fish_lsp_using_command complete; and not __fish_contains_opt toggle'   -l toggle   -d 'show feature names of completions'
`;

const loggerCompletions: string = `# fish-lsp logger --<TAB>
complete -c fish-lsp -n __fish_use_subcommand -x -a logger -d 'logger utilities'
complete -c fish-lsp -n '__fish_lsp_using_command logger; and not __fish_contains_opt -s s show'  -s s -l show   -d 'show the "logs.txt" file'
complete -c fish-lsp -n '__fish_lsp_using_command logger; and not __fish_contains_opt -s c clear' -s c -l clear  -d 'clear the "logs.txt" file'
complete -c fish-lsp -n '__fish_lsp_using_command logger; and not __fish_contains_opt -s q quiet' -s q -l quiet  -d 'only write to "logs.txt" file'
complete -c fish-lsp -n '__fish_lsp_using_command logger; and not __fish_contains_opt -s d date'  -s d -l date   -d 'write date to "logs.txt" file'
complete -c fish-lsp -n '__fish_lsp_using_command logger; and not __fish_contains_opt config'          -l config -d 'show the logger config'
`;

const infoCompletions: string = `# fish-lsp info --<TAB>
complete -c fish-lsp -n '__fish_lsp_using_command info; and not __fish_contains_opt bin'           -l bin            -d 'show the binary path'
complete -c fish-lsp -n '__fish_lsp_using_command info; and not __fish_contains_opt repo'          -l repo           -d 'show the repo path'
complete -c fish-lsp -n '__fish_lsp_using_command info; and not __fish_contains_opt time'          -l time           -d 'show the build-time'
complete -c fish-lsp -n '__fish_lsp_using_command info; and not __fish_contains_opt env'           -l env            -d 'show the env-variables used'
complete -c fish-lsp -n '__fish_lsp_using_command info; and not __fish_contains_opt lsp-version'   -l lsp-verision   -d 'show the npm package for the lsp-verision'
complete -c fish-lsp -n '__fish_lsp_using_command info; and not __fish_contains_opt capabilities'  -l capabilities   -d 'show the lsp capabilities implemented' 
complete -c fish-lsp -n '__fish_lsp_using_command info; and not __fish_contains_opt man-file'      -l man-file       -d 'show man file path'
complete -c fish-lsp -n '__fish_lsp_using_command info; and not __fish_contains_opt logs-file'     -l logs-file      -d 'show logs.txt file path'
complete -c fish-lsp -n '__fish_lsp_using_command info; and not __fish_contains_opt more'          -l more           -d 'show more info'
`;

// const completeCompletions: string = `# fish-lsp complete <TAB>
const envCompletions: string = `# fish-lsp env --<TAB>
complete -c fish-lsp -n __fish_use_subcommand -x -a env -d 'generate fish shell env variables to be used by lsp'
complete -c fish-lsp -n '__fish_lsp_using_command env; and not __fish_contains_opt -s s show; and not __fish_contains_opt -s c create' -s s -l show        -d 'show the current fish-lsp env variables'
complete -c fish-lsp -n '__fish_lsp_using_command env; and not __fish_contains_opt -s c create; and not __fish_contains_opt -s s show' -s c -l create      -d 'build initial fish-lsp env variables'
complete -c fish-lsp -n '__fish_lsp_using_command env; and not __fish_contains_opt no-comments'                                             -l no-comments -d 'skip outputting comments'
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

  output.push('# disable file completions');
  output.push('complete -c fish-lsp -f', '');
  output.push(`complete -c fish-lsp -n "__fish_use_subcommand" -a "\n${subcmdStrs}\"`);

  output.push([
    '',
    'set __fish_lsp_subcommands start',
    '',
    '# fish_lsp [start] --<TAB> ',
    'complete -c fish-lsp -n \'__fish_seen_subcommand_from $__fish_lsp_subcommands\' -a \"',
    '--dump\\t\'dump output and stop server\'',
    '--enable\\t\'enable feature\'',
    '--disable\\t\'disable feature\'\"',
    '',
  ].join('\n'));

  output.push(urlCompletions);

  output.push(completeCompletions);
  output.push(infoCompletions);
  output.push(loggerCompletions);

  output.push(featuresCompletions);
  output.push(envCompletions);
  output.push('# COMPLETION: fish-lsp subcmd <option> [VALUE] (`fish-lsp start --enable ...`)');
  output.push('complete -c fish-lsp -n \'__fish_seen_subcommand_from $__fish_lsp_subcommands\' -l enable -xa \'(_fish_lsp_get_features)\'');
  output.push('complete -c fish-lsp -n \'__fish_seen_subcommand_from $__fish_lsp_subcommands\' -l disable -xa \'(_fish_lsp_get_features)\'');

  output.push('');
  output.push('# built by the command: ');
  output.push('# fish-lsp complete ~/.config/fish/completions/fish-lsp.fish');
  return output.join('\n');
}
