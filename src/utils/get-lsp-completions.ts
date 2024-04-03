
import { Command } from 'commander';
import { ConfigMap } from './configuration-manager';

// firefox-dev https://github.com/fish-shell/fish-shell/blob/master/share/completions/cjxl.fish
export function buildFishLspCompletions(commandBin: Command) {
  const subcmdStrs = commandBin.commands.map(cmd => `${cmd.name()}\\t'${cmd.summary()}'`).join('\n');
  const output: string[] = [];
  output.push('# fish-lsp complete --fish > ~/.config/fish/completions/fish-lsp.fish');
  output.push('complete -c fish-lsp -f', '\n');
  output.push('complete -c fish-lsp -n "__fish_use_subcommand" -a "\n' + subcmdStrs + '\"');
  // output.push('complete -c fish-lsp -n "__fish_seen_subcommand_from start" -a "show --enable --disable"');
  output.push('\nset __fish_lsp_subcommands bare min start\n');
  output.push(
    [
      'complete -c fish-lsp -n \'__fish_seen_subcommand_from $__fish_lsp_subcommands\' -a \"',
      '--dump\\t\'dump output and stop server\'',
      '--enable\\t\'enable feature\'',
      '--disable\\t\'disable feature\'\"',
      '',
    ].join('\n').trimStart(),
  );
  output.push(
    [
      'complete -c fish-lsp -n "__fish_seen_subcommand_from url" -a \"',
      '--repo\\t\'show git url\'',
      '--git\\t\'show git url\'',
      '--npm\\t\'show npm url\'',
      '--homepage\\t\'show homepage url\'',
      '--contributions\\t\'show git contributions url\'',
      '--wiki\\t\'show git wiki url\'',
      '--issues\\t\'show git issues url\'',
      '--report\\t\'show git issues url\'',
      '--discussions\\t\'show git discussions url\'',
      '--clients-repo\\t\'show git clients-repo url\'',
      '--sources\\t\'show useful list of sources\'\"',
      '',
    ].join('\n').trimStart(),
  );
  output.push(
    [
      'complete -c fish-lsp -n "__fish_seen_subcommand_from complete" -a \"',
      '--names\\t\'show the feature names of the completions\'',
      '--toggles\\t\'show the feature names of the completions\'',
      '--fish\\t\'show fish script\'',
      '--features\\t\'show features\'\"',
      '',
    ].join('\n').trimStart(),
  );

  output.push('set __info_subcommands \'info\'');
  output.push([
    'complete -c fish-lsp -n "__fish_seen_subcommand_from $__info_subcommands" -a \"',
    '--bin\\t\'show bin path\'',
    '--repo\\t\'show repo path\'',
    '--time\\t\'show build-time\'',
    '--env\\t\'show the env variables used\'',
    '--lsp-version\\t\'show the lsp version\'',
    '--capabilities\\t\'show the lsp capabilities implemented\'',
    '--man-file\\t\'show man file path\'',
    '--logs-file\\t\'show logs.txt file path\'',
    '--more\\t\'show more info\'\"',
    '',
  ].join('\n'));

  output.push([
    'function _fish_lsp_get_features',
    `    printf %b\\n ${ConfigMap.configNames.join(' ')}`,
    'end',
  ].join('\n'));
  // output.push('    fish-lsp complete --features')

  output.push('# COMPLETION: fish-lsp subcmd <option> [VALUE] (`fish-lsp start --enable ...`)');
  output.push('complete -c fish-lsp -n \'__fish_seen_subcommand_from $__fish_lsp_subcommands\' -l enable -xa \'(_fish_lsp_get_features)\'');
  output.push('complete -c fish-lsp -n \'__fish_seen_subcommand_from $__fish_lsp_subcommands\' -l disable -xa \'(_fish_lsp_get_features)\'');
  output.push('\n# cp ~/.config/fish/completions/fish-lsp.fish ~/.config/fish/completions/fish-lsp.fish.bak');
  output.push('# fish-lsp complete --fish > ~/.config/fish/completions/fish-lsp.fish');
  return output.join('\n');
}
