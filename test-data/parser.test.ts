import { setLogger } from './helpers';
import { initializeParser } from '../src/parser';

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

describe('parser test-suite', () => {
  it('should be able to load the parser', async () => {
    const parser = await initializeParser();
    const t = parser.parse('set -gx v "hello world"').rootNode;
    expect(parser).toBeDefined();
  });

  it('should parse the fish string', async () => {
    const parser = await initializeParser();
    const t = parser.parse('set -gx v "hello world"').rootNode;
    expect(parser).toBeDefined();
    expect(t.children.length).toBeGreaterThanOrEqual(1);
  });

  it('nodeTypeCount', async () => {
    const parser = await initializeParser();
    const lang = parser.getLanguage();
    expect(lang.nodeSubclasses).toHaveLength(105);
  });
});
