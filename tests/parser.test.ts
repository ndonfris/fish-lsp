import { setLogger } from './helpers';
import { initializeParser } from '../src/parser';
import { logger } from '../src/logger';
import Parser from 'web-tree-sitter';
import { cpSync, mkdirSync, rmSync } from 'fs';
import { join, resolve } from 'path';

export const nodeNamedTypes: string[] = [
  'word',
  'integer',
  'float',
  'break',
  'continue',
  'comment',
  'variable_name',
  'escape_sequence',
  'stream_redirect',
  'direction',
  'home_dir_expansion',
  'glob',
  'word',
  'program',
  'conditional_execution',
  'pipe',
  'redirect_statement',
  'negated_statement',
  'command_substitution',
  'function_definition',
  'return',
  'switch_statement',
  'case_clause',
  'for_statement',
  'while_statement',
  'if_statement',
  'else_if_clause',
  'else_clause',
  'begin_statement',
  'variable_expansion',
  'index',
  'range',
  'list_element_access',
  'brace_expansion',
  'double_quote_string',
  'single_quote_string',
  'command',
  'file_redirect',
  'concatenation',
];

export const nodeFieldTypes: string[] = [
  'null', 'argument',
  'condition', 'destination',
  'name', 'operator',
  'option', 'redirect',
  'value', 'variable',
];

setLogger();

type LogType = 'log' | 'warning' | 'debug' | 'error' | '';
let logs: { type: LogType; index: number; message: any; }[] = [] as any[];
const showLogs = () => {
  console.log(logs.map(log => `[${log.type.toUpperCase()}:${log.index}]: ${log.message}`).join('\n') + '\n');
};
let parser: Parser;
const getLangInfo = () => {
  const lang = parser.getLanguage();
  const result = {
    fieldCount: lang.fieldCount,
    nodeTypeCount: lang.nodeTypeCount,
    nodeTypes: [] as string[],
    fieldNames: [] as string[],
  };
  for (let i = 0; i < lang.fieldCount; ++i) {
    const fieldName = lang.fieldNameForId(i);
    if (!fieldName) continue;
    result.fieldNames.push(fieldName);
  }

  for (let i = 0; i < lang.nodeTypeCount; ++i) {
    let nodeType = lang.nodeTypeForId(i);
    if (!nodeType) continue;
    if (nodeType?.trim() === '') {
      nodeType = nodeType.replaceAll(/\s/g, '\\$1');
    }
    result.nodeTypes.push(nodeType);
  }
  return result;
};

describe('parser test-suite', () => {
  beforeEach(async () => {
    logs = [];
    const overwriteLogger = (type: LogType = '') => vitest.fn((...args: any[]) => {
      logs.push(...args.map((arg, idx) => {
        return { type, index: idx + logs.length, message: Array.isArray(arg) ? arg.join(' ') : arg };
      }));
    });
    logger.log = overwriteLogger('log');
    logger.debug = overwriteLogger('debug');
    logger.warning = overwriteLogger('warning');
    logger.error = overwriteLogger('error');
    parser = await initializeParser();
  });

  afterEach(() => {
    logs = [];
    logger.log = console.log;
    logger.debug = console.debug;
    logger.warning = console.warn;
    logger.error = console.error;
    parser = undefined as any;
  });

  it('should be able to load the parser', () => {
    // const fish = require('tree-sitter-fish');
    // const parser = await initializeParser();
    const t = parser.parse('set -gx v "hello world"').rootNode;
    expect(parser).toBeDefined();
    expect(t.children.length).toBeGreaterThanOrEqual(1);
  });

  it('should parse the fish string', () => {
    // const fish = require('tree-sitter-fish');
    // const parser = await initializeParser();
    const t = parser.parse('set -gx v "hello world"').rootNode;
    expect(parser).toBeDefined();
    expect(t.children.length).toBeGreaterThanOrEqual(1);
  });

  it('should expand ~ in fish_lsp_tree_sitter_wasm_path overrides', async () => {
    const testHome = resolve(__dirname, 'workspaces', 'parser-wasm-home');
    const wasmDir = join(testHome, 'wasm');
    const wasmFile = join(wasmDir, 'tree-sitter-fish.wasm');
    const originalHome = process.env.HOME;
    const originalOverride = process.env.fish_lsp_tree_sitter_wasm_path;

    mkdirSync(wasmDir, { recursive: true });
    cpSync(resolve(__dirname, '../node_modules/@esdmr/tree-sitter-fish/tree-sitter-fish.wasm'), wasmFile);

    process.env.HOME = testHome;
    process.env.fish_lsp_tree_sitter_wasm_path = '~/wasm/tree-sitter-fish.wasm';

    try {
      const overrideParser = await initializeParser();
      const tree = overrideParser.parse('echo hello').rootNode;
      expect(tree.children.length).toBeGreaterThanOrEqual(1);
    } finally {
      if (typeof originalHome === 'undefined') {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }

      if (typeof originalOverride === 'undefined') {
        delete process.env.fish_lsp_tree_sitter_wasm_path;
      } else {
        process.env.fish_lsp_tree_sitter_wasm_path = originalOverride;
      }

      rmSync(testHome, { recursive: true, force: true });
    }
  });

  it('fieldCounts', () => {
    // const parser = await initializeParser();
    const { fieldCount } = parser.getLanguage();
    const lang = parser.getLanguage();
    expect(lang.fieldCount).toBeGreaterThanOrEqual(9);
    expect(fieldCount).toBeGreaterThanOrEqual(9);
    if (fieldCount > 9) {
      expect(lang.fieldIdForName('override')).toBeTruthy();
    }
  });

  it('nodeTypeCount', () => {
    // const parser = await initializeParser();
    const lang = parser.getLanguage();
    expect(lang.nodeTypeCount).toBeGreaterThanOrEqual(106);
    if (lang.nodeTypeCount > 106) {
      logger.debug([
        `Expected nodeTypeCount to be at least 106, but got ${lang.nodeTypeCount}.`,
        'This may indicate that the parser has been updated with new node types.',
      ]);
    }
  });

  it('nodeTypes', () => {
    const lang = parser.getLanguage();
    for (let i = 0; i < lang.nodeTypeCount; ++i) {
      if (lang.nodeTypeIsNamed(i)) {
        const typeName = lang.nodeTypeForId(i);
        expect(typeName).toBeTruthy();
      }
    }
  });

  it.skip('testing field -> "override" & nodeType -> "override_variable"', () => {
    const { fieldNames, nodeTypes } = getLangInfo();
    const overrideField = fieldNames.find(field => field === 'override');
    const overrideNode = nodeTypes.find(type => type === 'override_variable');
    // expect(overrideField).toBeTruthy();
    // expect(overrideNode).toBeTruthy();
    logger.log(`Found override field: ${overrideField}, override node type: ${overrideNode}`);
    showLogs();
  });
});
