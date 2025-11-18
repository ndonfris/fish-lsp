import * as os from 'os';
import { homedir } from 'os';
import * as Parser from 'web-tree-sitter';
import { SyntaxNode, Tree } from 'web-tree-sitter';
import { findChildNodes, getChildNodes, getNodeAtRange, nodesGen } from '../src/utils/tree-sitter';
import { Diagnostic, DiagnosticSeverity, InitializedParams, InitializeParams, TextDocumentItem } from 'vscode-languageserver';
import { initializeParser } from '../src/parser';
import { ErrorCodes } from '../src/diagnostics/error-codes';
// import { fishNoExecuteDiagnostic } from '../src/diagnostics/no-execute-diagnostic';
import { isCommand, isComment, isDefinitionName } from '../src/utils/node-types';
// import { ScopeStack, isReference } from '../src/diagnostics/scope';
import { findErrorCause, isExtraEnd, isZeroIndex, isSingleQuoteVariableExpansion, isAlias, isUniversalDefinition, isSourceFilename, isTestCommandVariableExpansionWithoutString, isConditionalWithoutQuietCommand, isVariableDefinitionWithExpansionCharacter, isArgparseWithoutEndStdin } from '../src/diagnostics/node-types';
import { LspDocument } from '../src/document';
import { createFakeLspDocument, setLogger, fail, createMockConnection } from './helpers';
import { getDiagnosticsAsync } from '../src/diagnostics/async-validate';
import { DiagnosticComment, DiagnosticCommentsHandler, isDiagnosticComment, parseDiagnosticComment } from '../src/diagnostics/comments-handler';
import { withTempFishFile } from './temp';
import { workspaceManager } from '../src/utils/workspace-manager';
// import { Option } from '../src/parsing/options';
import { getNoExecuteDiagnostics } from '../src/diagnostics/no-execute-diagnostic';
import { analyzer, Analyzer } from '../src/analyze';
import { config } from '../src/config';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { logger } from '../src/logger';
import { testOpenDocument } from './document-test-helpers';
import { PrebuiltDocumentationMap } from '../src/utils/snippets';
import { CompletionItemMap } from '../src/utils/completion/startup-cache';
import { Server } from 'http';
import FishServer from '../src/server';
import { connection, startServer } from '../src/utils/startup';
// import { isFunctionDefinitionName, isFunctionVariableDefinitionName } from '../src/parsing/function';
// import TestWorkspace from './test-workspace-utils';
// import { isArgparseVariableDefinitionName } from '../src/parsing/argparse';
// import { SetParser, AliasParser, ArgparseParser, CompleteParser, ReadParser, ForParser, FunctionParser, ExportParser } from '../src/parsing/barrel';

let parser: Parser;
let diagnostics: Diagnostic[] = [];
let output: SyntaxNode[] = [];
let input: string = '';

setLogger(
  async () => {
    parser = await initializeParser(); diagnostics = []; input = ''; output = [];
    // Reset config to avoid test pollution
    config.fish_lsp_diagnostic_disable_error_codes = [];
    // Disable expensive unknown command check for unit tests
    config.fish_lsp_diagnostic_disable_error_codes.push(ErrorCodes.unknownCommand);
  },
  async () => {
    parser.reset();
    // Reset config after each test
    config.fish_lsp_diagnostic_disable_error_codes = [];
  },
);

function fishTextDocumentItem(uri: string, text: string): LspDocument {
  return new LspDocument({
    uri: `file://${homedir()}/.config/fish/${uri}`,
    languageId: 'fish',
    version: 1,
    text,
  } as TextDocumentItem);
}

function severityStr(severity: DiagnosticSeverity | undefined) {
  switch (severity) {
    case DiagnosticSeverity.Error: return 'Error';
    case DiagnosticSeverity.Warning: return 'Warning';
    case DiagnosticSeverity.Information: return 'Information';
    case DiagnosticSeverity.Hint: return 'Hint';
    default: return 'Unknown';
  }
}

function logDiagnostics(diagnostic: Diagnostic, root: SyntaxNode) {
  console.log('-'.repeat(80));
  console.log(`entire text:     \n${root.text.slice(0, 20) + '...'}`);
  console.log(`diagnostic node: ${getNodeAtRange(root, diagnostic.range)?.text}`);
  console.log(`message:         ${diagnostic.message.toString()}`); // check uri for config.fish
  console.log(`severity:        ${severityStr(diagnostic.severity)}`); // check uri for config.fish
  console.log(`range:           ${JSON.stringify(diagnostic.range)}`); // check uri for config.fish
  console.log('-'.repeat(80));
}

function extractDiagnostics(tree: Tree) {
  const results: SyntaxNode[] = [];
  const cursor = tree.walk();
  const visitNode = (node: Parser.SyntaxNode) => {
    if (node.isError) {
      results.push(node);
    }
    for (const child of node.children) {
      visitNode(child);
    }
  };
  visitNode(tree.rootNode);
  return results;
}

describe('diagnostics test suite', () => {
  beforeAll(async () => {
    await Analyzer.initialize();
    createMockConnection();
    await FishServer.create(connection, {} as InitializeParams);
    logger.setSilent();
    await setupProcessEnvExecFile();
  });

  beforeEach(async () => {
    await Analyzer.initialize();
    logger.setSilent();
    config.fish_lsp_diagnostic_disable_error_codes = [4008];
    config.fish_lsp_strict_conditional_command_warnings = false;
  });

  afterEach(() => {
    config.fish_lsp_diagnostic_disable_error_codes = [];
    config.fish_lsp_strict_conditional_command_warnings = false;
  });

  afterAll(() => {
    config.fish_lsp_diagnostic_disable_error_codes = [];
    config.fish_lsp_strict_conditional_command_warnings = true;
    logger.setSilent(false);
  });

  it('NODE_TEST: test finding specific error nodes', async () => {
    const inputs: string[] = [
      [
        'echo "function error"',
        'function foo',
        '    if test -n $argv',
        '        echo "empty"',
        '     ',
        'end',
      ].join('\n'),
      [
        'echo "while error"',
        'while true',
        '     echo "is true"',
        '',
      ].join('\n'),
      ['echo \'\' error\'', 'string match \''].join('\n'),
      ['echo \'\" error\'', 'string match -r "'].join('\n'),
      ['echo "\(" error', 'echo ('].join('\n'),
      ['echo \'\$\( error\'', 'echo $('].join('\n'),
      ['echo \'\{ error\'', 'echo {a,b'].join('\n'),
      ['echo \'\[ error\'', 'echo $argv['].join('\n'),
      ['echo \'\[ error\'', 'echo "$argv["'].join('\n'),
      ['echo \'\$\( error\'', 'echo "$("'].join('\n'),
    ];
    const output: SyntaxNode[] = [];
    inputs.forEach((input, _) => {
      const tree = parser.parse(input);
      const result = extractDiagnostics(tree).pop()!;
      for (const r of nodesGen(result)) {
        if (!r.isError) continue;
        const errorNode = findErrorCause(r.children);
        // console.log(getChildNodes(r).map(n => n.text + ':::' + n.type))
        // if (errorNode) console.log('------\nerrorNode', errorNode.text);
        if (!errorNode) fail();
        output.push(errorNode!);
      }
    });
    expect(
      output.map(n => n.text),
    ).toEqual(
      ['function', 'while', '"', '(', '(', '{', '[', '[', '('],
    );
  });

  it('NODE_TEST: check for extra end', async () => {
    input = [
      'function foo',
      '    echo "hi" ',
      'end',
      'end',
    ].join('\n');
    const tree = parser.parse(input);
    for (const node of nodesGen(tree.rootNode)) {
      if (isExtraEnd(node)) {
        // console.log({type: node.type, text: node.text});
        output.push(node);
      }
    }
    expect(output.length).toBe(1);
  });

  it('NODE_TEST: 0 indexed array', async () => {
    input = 'echo $argv[0]';
    const { rootNode } = parser.parse(input);
    for (const node of nodesGen(rootNode)) {
      if (isZeroIndex(node)) {
        // console.log({type: node.type, text: node.text});
        output.push(node);
      }
    }
    expect(output.length).toBe(1);
  });

  it('NODE_TEST: single quote includes variable expansion', async () => {
    input = 'echo \' $argv\'';
    const { rootNode } = parser.parse(input);
    for (const node of nodesGen(rootNode)) {
      if (isSingleQuoteVariableExpansion(node)) {
        // console.log({type: node.type, text: node.text});
        // getChildNodes(node).forEach(n => console.log(n.text))
        output.push(node);
      }
    }
    expect(output.length).toBe(1);
  });

  it('NODE_TEST: isAlias definition', async () => {
    [
      'alias lst=\'ls --tree\'',
      'alias lst \'ls --tree\'',
      'alias lst "ls --tree"',
    ].forEach(input => {
      output = [];
      const { rootNode } = parser.parse(input);
      for (const node of nodesGen(rootNode)) {
        // console.log({type: node.type, text: node.text});
        if (isAlias(node)) {
          output.push(node);
        }
      }
      expect(output.length).toBe(1);
    });
  });

  it('NODE_TEST: universal definition in script', async () => {
    [
      'set -Ux uvar \'SOME VAR\'',
      'set --universal uvar \'SOME VAR\'',
    ].forEach(input => {
      const { rootNode } = parser.parse(input);
      for (const node of nodesGen(rootNode)) {
        // console.log({type: node.type, text: node.text});
        if (isUniversalDefinition(node)) {
          output.push(node);
        }
      }
    });
    expect(output.map(o => o.text)).toEqual([
      '-Ux',
      '--universal',
    ]);
  });

  it('NODE_TEST: find source file', async () => {
    [
      'source file_does_not_exist.fish',
      'source',
      'command cat file_does_not_exist.fish | source',
    ].forEach(input => {
      const { rootNode } = parser.parse(input);
      for (const node of getChildNodes(rootNode)) {
        if (isSourceFilename(node)) {
          output.push(node);
          // console.log({ type: node.type, text: node.text });
        }
        // if (isCommandWithName(node, 'source')) {
        //   console.log('SOURCE', { type: node.type, text: node.text, children: node.childCount});
        //   const filename = node.lastChild;
        //   if (filename) console.log('FILENAME', { type: filename.type, text: filename.text });
        // }
      }
    });
    expect(output.map(o => o.text)).toEqual(['file_does_not_exist.fish']);
  });

  it('NODE_TEST: isTestCommandVariableExpansionWithoutString \'test -n/-z "$var"\'', async () => {
    [
      'if test -n $arg0',
      'if test -z "$arg1"',
      '[ -n $argv[2] ]',
      '[ -z "$arg3" ]',
    ].forEach(input => {
      const { rootNode } = parser.parse(input);
      for (const node of getChildNodes(rootNode)) {
        if (isTestCommandVariableExpansionWithoutString(node)) {
          // console.log({ type: node.type, text: node.text });
          output.push(node);
        }
      }
    });
    expect(output.map(o => o.text)).toEqual([
      '$arg0',
      '$argv[2]',
    ]);
  });

  it('NODE_TEST: silent flag', async () => {
    config.fish_lsp_strict_conditional_command_warnings = true;
    const outputWithFlag: SyntaxNode[] = [];
    const outputWithoutFlag: SyntaxNode[] = [];
    [
      'if command -q ls;end',
      'if set -q argv; end',
      'if true; echo hi; else if string match -q; echo p; end',
      'if builtin -q set; end',
      'if functions -aq ls; end',
    ].forEach((input, _index) => {
      const { rootNode } = parser.parse(input);
      for (const node of nodesGen(rootNode)) {
        if (isConditionalWithoutQuietCommand(node)) {
          outputWithFlag.push(node);
        }
      }
    });

    [
      'if command ls;end',
      'if set argv; end',
      'if true; echo hi; else if string match; echo p; end',
      'if builtin set; end',
      'if functions ls; end',
      ['if test -n "$argv"',
        '   echo yes',
        'else if test -z "$argv"',
        '     set -Ux variable a',
        'end',
      ].join('\n'),
    ].forEach((input, _index) => {
      const { rootNode } = parser.parse(input);
      for (const node of nodesGen(rootNode)) {
        // if (index === 5 && node.type === 'if_statement') {
        // console.log({node: node.toString()});
        // const condition = node.namedChildren.find(child => child.type === 'condition')
        // console.log('condi', node.childrenForFieldName('condition').map(c => c.text));
        // console.log(node.namedChildren.map(c => c.type + ':' + c.text ));
        // console.log({ text: condition?.text, type: condition?.type, gType: condition?.grammarType });
        // }
        // if (node.type === 'condition') {
        // }
        if (isConditionalWithoutQuietCommand(node)) {
          outputWithoutFlag.push(node);
        }
      }
    });
    expect(outputWithFlag.length).toBe(0);
    expect(outputWithoutFlag.length).toBe(5);
  });

  it('NODE_TEST: `if set -q var_name` vs `if set -q $var_name`', async () => {
    [
      'if set -q $variable_1; echo bad; end',
      'if set -q variable_2; echo good; end',
      'set $variable_3 (echo "a b c d e f $argv[2]") ',
      'set $variable_4 $PATH',
    ].forEach(input => {
      const { rootNode } = parser.parse(input);
      for (const node of getChildNodes(rootNode)) {
        if (isVariableDefinitionWithExpansionCharacter(node)) {
          // console.log({ type: node.type, text: node.text, p: node.parent?.text || 'null' });
          output.push(node);
        }
      }
    });

    expect(output.map(o => o.text)).toEqual([
      '$variable_3',
      '$variable_4',
    ]);
  });

  it('NODE_TEST: conditional', async () => {
    config.fish_lsp_strict_conditional_command_warnings = false;
    type ConditionalOutput = {
      idx: number;
      node: string;
    };
    const _output: ConditionalOutput[] = [];
    const testInputs = [
      'if set -q var || set -l bad_1; echo "var is set"; end;',
      'if set -q var; or set -l bad_2; echo "var is set"; end;',
      'if set fishpath (which fish); echo "$fishpath is set"; end;',
      'if not string match -q -- $PNPM_HOME $PATH; set -gx PATH "$PNPM_HOME" $PATH; end;',
      `
if string match -q -- $PNPM_HOME $PATH \\
    or set -q _flag_a 
  set -gx PATH "$PNPM_HOME" $PATH
end`,
      `
if set -xq __flag || set fishdir (command -v fish)
    echo fishdir: $fishdir
end

if set -qx __flag || set fishdir (command -v fish)
    echo fishdir: $fishdir
else if set -q __flag \\
    || set -q fishdir (command -v fish)
    echo fishdir: $fishdir
end

if set fishdir (status fish-path | string match -vr /bin/)
    echo fishdir: $fishdir
end

if functions -q fish_prompt
    echo fish_prompt
end

if command -q fish (status fish-path)
    echo fish: $fish
end

if builtin --query echo
    echo 'echo'
end

if type --all --query ls || functions -q ls || command -aq ls
    echo 'ls'
end

awk
      `];
    for (let idx = 0; idx < testInputs.length; idx++) {
      const input = testInputs[idx]!;
      const { root, document } = analyzer.ensureCachedDocument(createFakeLspDocument(`file:///tmp/test-${idx}.fish`, input));
      if (!root || !document) continue;
      // completion

      diagnostics = await getDiagnosticsAsync(root, document);
      console.log(`---- input ${idx} ----`);
      diagnostics.forEach(d => logDiagnostics(d, root));
      console.log({
        idx: idx,
        diagnostics: diagnostics.map(d => ({
          text: document.getText(d.range),
          code: d.code,
          mes: d.message,
          node: d.data.node.parent.text,
        })),
      });
      _output.push(...diagnostics.map((d) => ({ node: d.data.node.parent.text, idx: idx })));
    }
    console.log(_output);
    expect(_output).toEqual([
      {
        idx: 0,
        node: 'set -l bad_1',
      },
      {
        idx: 1,
        node: 'set -l bad_2',
      },
    ]);
  });

  /**
  * TODO:
  *     Improve references usage for autoloaded functions, and other scopes
  */
  it('NODE_TEST: unused local definition', async () => {
    const input = [
      '# input 1',
      'function foo',
      '    echo "inside foo" ',
      'end',
      'set --local variable_1 a',
      'set --local variable_2 b',
      'set --global variable_3 c',
    ].join('\n');
    const { root, document } = analyzer.ensureCachedDocument(createFakeLspDocument('file:///tmp/test-1.fish', input));
    if (!root) return;
    const defs = nodesGen(root).filter(n => {
      return isDefinitionName(n);
    });

    expect(defs.map(d => d.text).toArray()).toEqual([
      'foo',
      'variable_1',
      'variable_2',
      'variable_3',
    ]);

    const result = await getDiagnosticsAsync(root, document);
    expect(result.length).toBe(3);
  });

  it('VALIDATE: missing end', async () => {
    [
      'echo "',
      'echo \'',
      'echo {a,b,c',
      'echo $argv[',
      'echo (',
      'echo $(',
    ].forEach(async (input, idx) => {
      analyzer.ensureCachedDocument(createFakeLspDocument(`file:///tmp/test-${idx}.fish`, input));
      const { rootNode } = parser.parse(input);
      const doc = createFakeLspDocument(`file:///tmp/test-${idx}.fish`, input);
      const result = await getDiagnosticsAsync(rootNode, doc, undefined, 1);
      expect(result.length).toBe(1);
    });
  });

  it('VALIDATE: extra end', async () => {
    // Disable unused local definition check for this test
    const savedDisabled = [...config.fish_lsp_diagnostic_disable_error_codes];
    config.fish_lsp_diagnostic_disable_error_codes = [ErrorCodes.unknownCommand, ErrorCodes.unusedLocalDefinition];

    [
      'for i in (seq 1 10); end; end',
      'function foo; echo hi; end; end',
    ].forEach(async (input, idx) => {
      const doc = createFakeLspDocument(`file:///tmp/test-${idx}.fish`, input);
      const cached = analyzer.ensureCachedDocument(doc).ensureParsed();
      const { root } = cached;
      const result = await getDiagnosticsAsync(root, doc);
      expect(result.length).toBe(1);
    });

    // Restore config
    config.fish_lsp_diagnostic_disable_error_codes = savedDisabled;
  });

  it('VALIDATE: zero index', async () => {
    [
      'echo $argv[0]',
    ].forEach(async (input, idx) => {
      analyzer.ensureCachedDocument(createFakeLspDocument(`file:///tmp/test-${idx}.fish`, input));
      const { rootNode } = parser.parse(input);
      const doc = createFakeLspDocument(`file:///tmp/test-${idx}.fish`, input);
      const result = await getDiagnosticsAsync(rootNode, doc);
      expect(result.map(r => r.code)).toContain(ErrorCodes.zeroIndexedArray);
      expect(result.length).toBe(1);
    });
  });

  it.skip('VALIDATE: isSingleQuoteVariableExpansion', () => {
    [
      'echo \'$argv[1]\'; echo \'\\$argv[1]\'',
    ].forEach(async (input, idx) => {
      const { rootNode } = parser.parse(input);
      const doc = createFakeLspDocument(`file:///tmp/test-${idx}.fish`, input);
      analyzer.ensureCachedDocument(doc);
      const result = await getDiagnosticsAsync(rootNode, doc);
      expect(result.length).toBe(1);
    });
  });

  it('VALIDATE: isAlias', async () => {
    // config.fish_lsp_diagnostic_disable_error_codes.push(ErrorCodes.usedAlias);
    [
      'alias foo=\'fish_opt\'\nfoo',
    ].forEach(async (input, idx) => {
      const { rootNode } = parser.parse(input);
      const doc = createFakeLspDocument(`file:///tmp/test-${idx}.fish`, input);
      analyzer.ensureCachedDocument(doc);
      const result = await getDiagnosticsAsync(rootNode, doc);
      result.forEach(r => logDiagnostics(r, rootNode));
      expect(result.length).toBe(1);
      const diagnosticTypes = result.map(r => r.code);
      expect(diagnosticTypes).toContain(ErrorCodes.usedWrapperFunction);
    });
  });

  it('VALIDATE: isUniversal', async () => {
    [
      'set -U _foo abcdef',
      'set -U _foo abcdef',
    ].forEach(async (input, idx) => {
      const { rootNode } = parser.parse(input);
      const uri = idx === 1 ? `file://${os.homedir()}/.config/fish/conf.d/test-1.fish` : `file:///tmp/test-${idx}.fish`;
      const doc = createFakeLspDocument(uri, input);
      analyzer.ensureCachedDocument(doc);
      const result = await getDiagnosticsAsync(rootNode, doc);
      if (idx === 0) {
        expect(result.length).toBe(1);
      } else if (idx === 1) {
        expect(result.length).toBe(0);
      }
    });
  });

  it('VALIDATE: sourceFilename', async () => {
    [
      'source ~/.config/fish/__cconfig.fish',
      'source (echo get-fish-config-file)',
    ].forEach(async (input, idx) => {
      const uri = idx === 1 ? `file://${os.homedir()}/.config/fish/conf.d/test-1.fish` : `file:///tmp/test/test-${idx}.fish`;
      const doc = createFakeLspDocument(uri, input);
      const { root, document } = analyzer.analyze(doc).ensureParsed();
      // analyzer.ensureCachedDocument(doc);
      const result = await getDiagnosticsAsync(root, document);
      if (idx === 0) {
        expect(result.length).toBe(1);
      } else if (idx === 1) {
        // logger.setSilent(false);
        // logger.log(doc.showTree());
        expect(result.length).toBe(0);
      }
    });
  });

  it('VALIDATE: isTestCommandVariableExpansionWithoutString', async () => {
    [
      'test -n $argv',
      '[ -n $argv ]',
      '[ -z $argv[1] ]',
    ].forEach(async (input, idx) => {
      const { rootNode } = parser.parse(input);
      const uri = idx === 1 ? `file://${os.homedir()}/.config/fish/conf.d/test-1.fish` : `file:///tmp/test-${idx}.fish`;
      const doc = createFakeLspDocument(uri, input);
      analyzer.ensureCachedDocument(doc);
      const result = await getDiagnosticsAsync(rootNode, doc);
      expect(result.length).toBe(1);
    });
  });

  it('VALIDATE: isConditionalWithoutQuietCommand', async () => {
    config.fish_lsp_strict_conditional_command_warnings = true;

    [
      'if string match -r \'a\' "$argv";end;',
      'if set var;end;',
    ].forEach(async (input, idx) => {
      const { rootNode } = parser.parse(input);
      const uri = idx === 1 ? `file://${os.homedir()}/.config/fish/conf.d/test-1.fish` : `file:///tmp/test-${idx}.fish`;
      const doc = createFakeLspDocument(uri, input);
      analyzer.ensureCachedDocument(doc);
      const result = await getDiagnosticsAsync(rootNode, doc);
      expect(result.length).toBe(1);
    });
  });

  it('VALIDATE: isVariableDefinitionWithExpansionCharacter', async () => {
    [
      'set $argv a b c',
      'set $argv[1] a b c',
    ].forEach(async (input, idx) => {
      const { rootNode } = parser.parse(input);
      const uri = idx === 1 ? `file://${os.homedir()}/.config/fish/conf.d/test-1.fish` : `file:///tmp/test-${idx}.fish`;
      const doc = createFakeLspDocument(uri, input);
      analyzer.ensureCachedDocument(doc);
      const result = await getDiagnosticsAsync(rootNode, doc);
      expect(result.length).toBe(1);
    });
  });

  it('VALIDATE: isDiagnosticComment', async () => {
    const input = `echo 'now diagnostics are enabled'
# @fish-lsp-disable 
echo '1 all diagnostics are disabled'
# @fish-lsp-enable
echo '2 now diagnostics are enabled again'

# @fish-lsp-disable 2001
echo '3 only diagnostic error code 2001 is disabled'
# @fish-lsp-enable 2001
echo '4 diagnostic 2001 is enabled again'

# @fish-lsp-disable 1001 1002 1003
echo '5 only diagnostic error codes 1001 1002 1003 are disabled'
# @fish-lsp-enable
echo '6 enabled all diagnostics again'

# @fish-lsp-disable 3003 3002 3001
echo '7 disabled 3003 3002 3001'

# @fish-lsp-disable-next-line 2001 2002
echo '8 disable next line diagnostics for 2001 2002'
echo '9 2001 and 2002 are enabled again'
echo '10 3003 3002 3001 are still disabled'`;
    const { rootNode } = parser.parse(input);
    const doc = createFakeLspDocument('file:///tmp/test-1.fish', input);
    analyzer.ensureCachedDocument(doc);
    const lspDiagnosticComments: DiagnosticComment[] =
      findChildNodes(rootNode, n => isDiagnosticComment(n))
        .map(parseDiagnosticComment)
        .filter(c => c !== null);

    const enabledDiagnostics = ErrorCodes.allErrorCodes; // need to disable config.fish_lsp_disabled_error_codes

    const handler = new DiagnosticCommentsHandler();
    nodesGen(rootNode).forEach(node => {
      handler.handleNode(node);
      if (!isComment(node) && node.isNamed && isCommand(node)) {
        if (node.text.includes('1 all diagnostics are disabled')) {
          expect(handler.isCodeEnabled(1001)).toBe(false);
          expect(handler.isCodeEnabled(2001)).toBe(false);
          expect(handler.isCodeEnabled(3001)).toBe(false);
        } else if (node.text.includes('2 now diagnostics are enabled again')) {
          expect(handler.isCodeEnabled(1001)).toBe(true);
        } else if (node.text.includes('3 only diagnostic error code 2001 is disabled')) {
          expect(handler.isCodeEnabled(1001)).toBe(true);
          expect(handler.isCodeEnabled(2001)).toBe(false);
          expect(handler.isCodeEnabled(3001)).toBe(true);
        } else if (node.text.includes('4 diagnostic 2001 is enabled again')) {
          expect(handler.isCodeEnabled(2001)).toBe(true);
          expect(handler.isCodeEnabled(3001)).toBe(true);
        } else if (node.text.includes('5 only diagnostic error codes 1001 1002 1003 are disabled')) {
          expect(handler.isCodeEnabled(1001)).toBe(false);
          expect(handler.isCodeEnabled(1002)).toBe(false);
          expect(handler.isCodeEnabled(1003)).toBe(false);
          expect(handler.isCodeEnabled(2001)).toBe(true);
          expect(handler.isCodeEnabled(3001)).toBe(true);
        } else if (node.text.includes('6 enabled all diagnostics again')) {
          expect(handler.isCodeEnabled(1001)).toBe(true);
          expect(handler.isCodeEnabled(1002)).toBe(true);
          expect(handler.isCodeEnabled(1003)).toBe(true);
          expect(handler.isCodeEnabled(2001)).toBe(true);
          expect(handler.isCodeEnabled(3001)).toBe(true);
        } else if (node.text.includes('7 disabled 3003 3002 3001')) {
          expect(handler.isCodeEnabled(1001)).toBe(true);
          expect(handler.isCodeEnabled(1002)).toBe(true);
          expect(handler.isCodeEnabled(3001)).toBe(false);
          expect(handler.isCodeEnabled(3002)).toBe(false);
          expect(handler.isCodeEnabled(3003)).toBe(false);
        } else if (node.text.includes('8 disable next line diagnostics for 2001 2002')) {
          expect(handler.isCodeEnabled(1003)).toBe(true);
          expect(handler.isCodeEnabled(2001)).toBe(false);
          expect(handler.isCodeEnabled(2002)).toBe(false);
          expect(handler.isCodeEnabled(3001)).toBe(false);
          expect(handler.isCodeEnabled(3002)).toBe(false);
          expect(handler.isCodeEnabled(3003)).toBe(false);
        } else if (node.text.includes('9 2001 and 2002 are enabled again')) {
          expect(handler.isCodeEnabled(2001)).toBe(true);
          expect(handler.isCodeEnabled(2002)).toBe(true);
          expect(handler.isCodeEnabled(3001)).toBe(false);
          expect(handler.isCodeEnabled(3002)).toBe(false);
          expect(handler.isCodeEnabled(3003)).toBe(false);
        } else if (node.text.includes('10 3003 3002 3001 are still disabled')) {
          expect(handler.isCodeEnabled(1001)).toBe(true);
          expect(handler.isCodeEnabled(1002)).toBe(true);
          expect(handler.isCodeEnabled(1003)).toBe(true);
          expect(handler.isCodeEnabled(1004)).toBe(true);
          expect(handler.isCodeEnabled(2001)).toBe(true);
          expect(handler.isCodeEnabled(2002)).toBe(true);
          expect(handler.isCodeEnabled(2003)).toBe(true);
          expect(handler.isCodeEnabled(3001)).toBe(false);
          expect(handler.isCodeEnabled(3002)).toBe(false);
          expect(handler.isCodeEnabled(3003)).toBe(false);
        }
      }
    });
  });
  describe('NODE_TEST: find argparse', () => {
    it('find argparse', async () => {
      const input = `
function foo
    argparse l/long s/short -- $argv
    or return
end`;

      const tree = parser.parse(input);
      const rootNode = tree.rootNode;
      analyzer.ensureCachedDocument(createFakeLspDocument('file:///tmp/test-argparse.fish', input));
      for (const node of nodesGen(rootNode)) {
        if (isArgparseWithoutEndStdin(node)) {
          console.log(node.text);
        }
      }
      expect(true).toBe(true);
    });
  });

  describe.skip('CONDITIONAL EDGE CASES', () => {
    const testcases = [
      // {
      //   title: 'normal case, where both variables are in a if statement, so both should be silenced',
      //   input: `if set -q var1 && set -q var2; echo 'var1 and var2 are set'; end`,
      //   expected: [
      //
      //   ],
      // },
      {
        shouldRun: true,
        title: '[CHAINED] updating a variable only when it exists 1',
        input: `
echo 'hello world'
if set var_with_default_value && set var_with_default_value 'new_value'
    echo hi
end
set ovar && set ovar 'new_value'
set uvar
and set uvar 'new_value'
`,
        expected: [
          'set var_with_default_value',
          'set var_with_default_value \'new_value\'',
          'set ovar',
          'set uvar',
        ],
      },
      {
        shouldRun: false,
        title: '[CHAINED] defining a variable only when it is not set',
        input: 'not set -q var_with_default_value && set var_with_default_value \'default_value\'',
        expected: [
          'var_with_default_value',
        ],
      },
      {
        title: '[CHAINED], updating a variable or defining it w/ default value',
        input: 'set -q var_with_default_value && set var_with_default_value \'new_value\' || set var_with_default_value \'default_value\'',
        expected: [
          'var_with_default_value',
        ],
      },
      {
        title: '[IF + CHAINED] if statement [expect silenced], inner blocks [only need first cmd silence]',
        input: `
# checks all edge cases for if statements
if set -q var1 && set -q var2
    set -q var3 && set var1 'new_value' && set var2 'new_value'
end
`,
        expected: [

        ],
      },
      {
        title: '[IF] normal if statement to silence a variable',
        input: 'if set -q var1; echo \'var1 is set\'; end',
        expected: [

        ],
      },
    ];

    // fix this usecase for when first `set` with child `nextSibling.type ==== conditional_execution`
    // does not have any value after `set`
    // ```
    // set uvar
    // and set uvar 'new_value'
    // ```
    // This should have a diagnostic but does not currently,
    // checkout files:
    //   - ../src/diagnostics/node-types.ts
    //   - ../src/diagnostics/validate.ts
    //  FIX SPECIFIC function `isConditionalStatement()`
    // testcases.forEach(({ title, input, expected, shouldRun }) => {
    //   if (shouldRun) {
    //     it.only(title, () => {
    //       // console.log(title);
    //       // console.log('-'.repeat(70));
    //       const { rootNode } = parser.parse(input);
    //       // console.log(rootNode.text);
    //       // console.log('-'.repeat(70));
    //       const result: SyntaxNode[] = [];
    //       for (const child of getChildNodes(rootNode)) {
    //         if (isConditionalWithoutQuietCommand(child)) {
    //           // console.log('conditional', {text: child.text});
    //           result.push(child);
    //         }
    //       }
    //       expect(result.map(r => r.text)).toEqual(expected);
    //     });
    //   }
    // });
  });

  describe.skip('fish --no-execute diagnostics', () => {
    afterEach(async () => {
      workspaceManager.clear();
    });

    it('NODE_TEST: fish --no-execute diagnostic 1', async () => {
      const input = `
function foo
    echo "hi"`;
      await withTempFishFile(input, async ({ document, path }) => {
        console.log({ document, path });
        analyzer.ensureCachedDocument(document);
        const result = getNoExecuteDiagnostics(document);
        console.log({ result });
        expect(result.length).toBe(1);
      });
    });

    it('VALIDATE: fish --no-execute diagnostic 2', async () => {
      const input = `
function foo
    echo "hi"`;
      await withTempFishFile(input, async ({ document, path }) => {
        console.log({ document, path });
        analyzer.ensureCachedDocument(document);
        const result = getNoExecuteDiagnostics(document);
        const finalRes = getNoExecuteDiagnostics(document);
        console.log({ finalRes, result });
      });
    });
  });
});

// expect(definitions.map(d => d.text)).toEqual([
//   'foo',
//   'variable_1',
//   'variable_2'
// ]);

/**
 * TODO:
 *      write argparse handler
 */
// it('NODE_TEST: argparse', async () => {
//
//
//
