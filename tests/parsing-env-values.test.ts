import * as os from 'os';
/* eslint-disable @typescript-eslint/quotes */

import { initializeParser } from '../src/parser';
import { createFakeLspDocument, setLogger } from './helpers';
// import { isLongOption, isOption, isShortOption, NodeOptionQueryText } from '../src/utils/node-types';
// import { SymbolKind } from 'vscode-languageserver';
import * as Parser from 'web-tree-sitter';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
// import { isFunctionDefinitionName } from '../src/parsing/function';
import { Analyzer } from '../src/analyze';
import { LspDocument } from '../src/document';
// import { LocalFishLspDocumentVariable } from '../src/parsing/values';
// import { config, ConfigSchema, Config, toBoolean, toNumber, getDefaultConfiguration, updateConfigValues } from '../src/config';
// import { z } from 'zod';
// import { logger } from '../src/logger';

let analyzer: Analyzer;
let parser: Parser;
/**
 * Symbolic workspace for testing
 */
let docs: LspDocument[] = [];
let doc: LspDocument;

type PrintClientTreeOpts = { log: boolean; };

describe('parsing $fish_lsp_* definitions & evaluating their values', () => {
  setLogger();
  beforeEach(async () => {
    setupProcessEnvExecFile();
    await setupProcessEnvExecFile();
    parser = await initializeParser();
    analyzer = new Analyzer(parser);
  });

  afterEach(() => {
    // Reset the parser and analyzer after each test
    parser.delete();
    docs = [];
  });

  it('config.fish defining $fish_lsp_enabled_handlers', () => {
    const doc = createFakeLspDocument('config.fish',
      `set fish_lsp_enabled_handlers 'complete' 'hover' 'signature'`,
    );
    analyzer.analyze(doc);
    expect(analyzer.getFlatDocumentSymbols(doc.uri).length).toBeGreaterThan(0);
  });

  it('config.fish defining $fish_lsp_disabled_handlers', () => {
    const doc = createFakeLspDocument('config.fish',
      `set fish_lsp_disabled_handlers 'hover' 'signature'`,
    );
    analyzer.analyze(doc);
    expect(analyzer.getFlatDocumentSymbols(doc.uri).length).toBeGreaterThan(0);
  });

  it('config.fish defining $fish_lsp_commit_characters', () => {
    const doc = createFakeLspDocument('config.fish',
      `set fish_lsp_commit_characters '.' ',' ';'`,
    );
    analyzer.analyze(doc);
    expect(analyzer.getFlatDocumentSymbols(doc.uri).length).toBeGreaterThan(0);
  });

  it('config.fish defining $fish_lsp_log_file', () => {
    const doc = createFakeLspDocument('config.fish',
      `set fish_lsp_log_file '/tmp/fish-lsp.log'`,
    );
    analyzer.analyze(doc);
    expect(analyzer.getFlatDocumentSymbols(doc.uri).length).toBeGreaterThan(0);
  });
  // describe('general finding $fish_lsp_*', () => {
  //   it('config.fish w/ config.** already set', () => {
  //     console.log(JSON.stringify(config, null, 2));
  //     doc = createFakeLspDocument('config.fish',
  //       `set fish_lsp_enabled_handlers 'complete'`,
  //       `set fish_lsp_disabled_handlers 'hover' 'signature'`,
  //       `set fish_lsp_commit_characters '.'`,
  //       `set fish_lsp_log_file '/tmp/fish-lsp.log'`,
  //       `set fish_lsp_log_level 'debug'`,
  //       `set fish_lsp_all_indexed_paths '${os.homedir()}/.config/fish' '/usr/share/fish'`,
  //       `set fish_lsp_modifiable_paths ''`,
  //       `set fish_lsp_diagnostic_disable_error_codes '2002' 4001`,
  //       `set fish_lsp_enable_experimental_diagnostics true`,
  //       `set fish_lsp_max_background_files 10`,
  //       'set fish_lsp_show_client_popups true',
  //       'set -eg fish_lsp_single_workspace_support',
  //       'set fish_lsp_single_workspace_support true',
  //     );
  //     analyzer.analyze(doc);
  //     const symbols = analyzer.getFlatDocumentSymbols(doc.uri);
  //     const fishLspSymbols = symbols.filter(s => s.kind === SymbolKind.Variable && s.name.startsWith('fish_lsp_'));
  //
  //     const newConfig: Record<keyof Config, unknown> = {} as Record<keyof Config, unknown>;
  //     const configCopy: Config = Object.assign({}, config);
  //
  //     for (const s of fishLspSymbols) {
  //       const configKey = Config.getEnvVariableKey(s.name);
  //       if (!configKey) {
  //         // configCopy[s.name] = ;
  //         continue;
  //       }
  //
  //       if (LocalFishLspDocumentVariable.hasEraseFlag(s)) {
  //         const schemaType = ConfigSchema.shape[configKey as keyof z.infer<typeof ConfigSchema>];
  //
  //         (config[configKey] as any) = schemaType.parse(schemaType._def.defaultValue());
  //         continue;
  //       }
  //
  //       const shellValues = LocalFishLspDocumentVariable.findValueNodes(s).map(s => LocalFishLspDocumentVariable.nodeToShellValue(s));
  //
  //       if (shellValues.length > 0) {
  //         if (shellValues.length === 1) {
  //           const value = shellValues[0];
  //           if (toBoolean(value)) {
  //             newConfig[configKey] = toBoolean(value);
  //             continue;
  //           }
  //           if (toNumber(value)) {
  //             newConfig[configKey] = toNumber(value);
  //             continue;
  //           }
  //           newConfig[configKey] = value;
  //           continue;
  //         } else {
  //           if (shellValues.every(v => !!toNumber(v))) {
  //             (newConfig[configKey] as any) = shellValues.map(v => toNumber(v));
  //           } else if (shellValues.every(v => toBoolean(v))) {
  //             (newConfig[configKey] as any) = shellValues.map(v => toBoolean(v));
  //           } else {
  //             (newConfig[configKey] as any) = shellValues;
  //           }
  //         }
  //       }
  //     }
  //     Object.assign(config, updateConfigValues(configCopy, newConfig));
  //     // console.log();
  //     console.log(config);
  //
  //     Object.assign(config, getDefaultConfiguration());
  //     console.log(config);
  //   });
  // });
});

