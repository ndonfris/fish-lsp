
import { Command } from 'commander';
import { ConfigMap } from './configuration-manager';

export function buildFishLspCompletions(commandBin: Command) {

  const subcmdStrs = commandBin.commands.map(cmd => `${cmd.name()}\\t'${cmd.summary()}'`).join('\n');
  const output: string[] = []
  output.push('# fish-lsp complete --fish > ~/.config/fish/completions/fish-lsp.fish');
  output.push('complete -c fish-lsp -f', '\n');
  output.push('complete -c fish-lsp -n "__fish_use_subcommand" -a "\n'+subcmdStrs+'\"');
  // output.push('complete -c fish-lsp -n "__fish_seen_subcommand_from start" -a "show --enable --disable"');
  output.push('\nset __fish_lsp_subcommands bare min start\n');
  output.push('complete -c fish-lsp -n \'__fish_seen_subcommand_from $__fish_lsp_subcommands\' -a \"\n',
    [
      `--show\\t'dump output and stop server'`,
      `--enable\\t'enable feature'`,
      `--disable\\t'disable feature'\"`, 
      ''
    ].join('\n'));
  output.push('complete -c fish-lsp -n "__fish_seen_subcommand_from startup-configuration" -a \"\n',
    [
      `--json\\t'show coc-settings.json output'`,
      `--lua\\t'show neovim *.lua output'\"`, 
      ''
    ].join('\n'));
  output.push('complete -c fish-lsp -n "__fish_seen_subcommand_from complete" -a \"\n',
    [
      `--names\\t'show the feature names of the completions'`,
      `--toggles\\t'show the feature names of the completions'`,
      `--fish\\t'show fish script'`,
      `--features\\t'show features'\"`, 
      ''
    ].join('\n'));

  output.push('complete -c fish-lsp -n "__fish_seen_subcommand_from show-path" -a \"\n',
    [
      `--bin\\t'show bin'`,
      `--repo\\t'show repo'\"`, 
      ''
    ].join('\n'));

  output.push('function _fish_lsp_get_features')
  // output.push('    fish-lsp complete --features')
  output.push('    printf %b\\n ', ConfigMap.configNames.join(' '))

  output.push('end\n')

  output.push('# COMPLETION: fish-lsp subcmd <option> [VALUE] (`fish-lsp start --enable ...`)')
  output.push('complete -c fish-lsp -n \'__fish_seen_subcommand_from $__fish_lsp_subcommands\' -l enable -xa \'(_fish_lsp_get_features)\'')
  output.push('complete -c fish-lsp -n \'__fish_seen_subcommand_from $__fish_lsp_subcommands\' -l disable -xa \'(_fish_lsp_get_features)\'')
  output.push('\n# cp ~/.config/fish/completions/fish-lsp.fish ~/.config/fish/completions/fish-lsp.fish.bak');
  output.push('# fish-lsp complete --fish > ~/.config/fish/completions/fish-lsp.fish');
  return output.join('\n');
}