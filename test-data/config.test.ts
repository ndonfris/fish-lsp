import { SignatureHelpRequest } from 'vscode-languageserver-protocol';
import { Snippets } from '../src/utils/snippets';
import { setLogger } from './helpers';

import { homedir } from 'os';

import { undefined, z } from 'zod';
import { Config, generateJsonSchemaShellScript, getConfigFromEnvironmentVariables, getDefaultConfiguration, showJsonSchemaShellScript } from '../src/config';
import { disable } from 'colors';
import { readFileSync } from 'fs';
import { accumulateStartupOptions } from '../src/utils/commander-cli-subcommands';

setLogger();

describe('test config', () => {
  it('test default', () => {
    const config = getDefaultConfiguration();
    // console.log(config);
    expect(config.fish_lsp_enabled_handlers.length).toBe(0);
  });

  it('test config from environment variables', () => {
    process.env.fish_lsp_enabled_handlers = 'complete hover diagnostic codeAction codeLens reference definition formatting folding signature executeCommand inlayHint';
    // process.env.fish_lsp_disabled_handlers = ''
    // process.env.fish_lsp_commit_characters = ''
    // process.env.fish_lsp_logfile  = ''
    // process.env.fish_lsp_format_tabsize = ''
    // process.env.fish_lsp_format_switch_case = ''
    // process.env.fish_lsp_all_indexed_paths = ''
    // process.env.fish_lsp_modfiable_paths = ''
    // process.env.fish_lsp_diagnostic_disable_error_codes = ''
    // process.env.fish_lsp_max_background_files = ''
    const { config, environmentVariablesUsed } = getConfigFromEnvironmentVariables();
    expect(environmentVariablesUsed.length).toBeGreaterThanOrEqual(1);
  });

  // it('generate config output', () => {
  //   generateJsonSchemaShellScript()
  // })
  //
  // it('other way', () => {
  //   showJsonSchemaShellScript()
  // })

  it('check if has fish_lsp_enabled_handler', () => {
    process.env.fish_lsp_enabled_handlers = 'complete hover diagnostic codeAction codeLens reference definition formatting folding signature executeCommand inlayHint';
    const { config } = getConfigFromEnvironmentVariables();
    expect(config.fish_lsp_enabled_handlers.length).toBe(12);
  });

  it('update flag from commandline: `fish-lsp start --disable complete`', () => {
    process.env.fish_lsp_enabled_handlers = 'complete hover diagnostic codeAction codeLens reference definition formatting folding signature executeCommand inlayHint';
    const cli = 'fish-lsp start --disable complete';
    const { enabled, disabled, dumpCmd } = accumulateStartupOptions(cli.split(' ').slice(1));
    if (dumpCmd) {
      console.log();
    }
  });
});
