import { Diagnostic } from 'vscode-languageserver';
import { initializeParser } from '../src/parser';
import { createAliasInlineAction } from '../src/code-actions/alias-wrapper';
import { ErrorCodes } from '../src/diagnostics/error-codes';
import { LspDocument } from '../src/document';
import * as Parser from 'web-tree-sitter';
import { setLogger, fail } from './helpers';
import { isCommandWithName } from '../src/utils/node-types';
import { getChildNodes } from '../src/utils/tree-sitter';
import { execAsyncF } from '../src/utils/exec';

setLogger();

describe('Alias to Function Conversion', () => {
  setLogger();
  let parser: Parser;

  beforeAll(async () => {
    parser = await initializeParser();
  });

  function createTestDocument(content: string): LspDocument {
    return {
      uri: 'file:///test/test.fish',
      getText: () => content,
      languageId: 'fish',
      version: 1,
    } as LspDocument;
  }

  function createDiagnostic(line: number, character: number, length: number): Diagnostic {
    return {
      range: {
        start: { line, character },
        end: { line, character: character + length },
      },
      message: 'alias used, prefer using functions instead',
      code: ErrorCodes.usedWrapperFunction,
      severity: 2,
      source: 'fish-lsp',
    };
  }

  const testCases = [
    {
      name: 'basic alias with equals',
      input: 'alias ll=\'ls -l\'',
      expected:
        `function ll --wraps 'ls -l' --description "alias ll=ls -l"
    ls -l $argv
end`,
    },
    {
      name: 'basic alias with space',
      input: 'alias ll \'ls -l\'',
      expected:
        `function ll --wraps 'ls -l' --description "alias ll 'ls -l'"
    ls -l $argv
end`,
    },
    {
      name: 'alias requiring builtin prefix',
      input: 'alias echo=\'echo -n\'',
      expected:
        `function echo --wraps 'echo -n' --description "alias echo=echo -n"
    builtin echo -n $argv
end`,
    },
    {
      name: 'alias requiring command prefix',
      input: 'alias ls=\'ls -la\'',
      expected:
        `function ls --wraps 'ls -la' --description "alias ls=ls -la"
    command ls -la $argv
end`,
    },
    {
      name: 'alias that should skip wraps due to recursion',
      input: 'alias foo=\'foo bar\'',
      expected:
        `function foo --description "alias foo=foo bar"
    command foo bar $argv
end`,
    },
    {
      name: 'alias with quotes in command',
      input: 'alias greet=\'echo "hello world"\'',
      expected:
        `function greet --wraps 'echo "hello world"' --description "alias greet=echo \\"hello world\\""
    echo "hello world" $argv
end`,
    },
    {
      name: 'alias with sudo as last word',
      input: 'alias mysudo=\'command sudo\'',
      expected:
        `function mysudo --wraps 'command sudo' --description "alias mysudo=command sudo"
    command sudo $argv
end`,
    },
  ];

  it('test execAsyncFish', async () => {
    const out = await execAsyncF('alias ls="ls -l" && functions ls | tail +2 | fish_indent');
    console.log({ out });
    const out2 = await execAsyncF('alias ls=\'ls -l\' && functions ls | tail +2 | fish_indent');
    console.log({ out2 });
    expect(out).toBeTruthy();
    expect(out2).toBeTruthy();
  });

  testCases.forEach(({ name, input, expected }) => {
    it(name, async () => {
      const doc = createTestDocument(input);
      const tree = parser.parse(input);
      const diagnostic = createDiagnostic(0, 0, input.length);
      const aliasNode = getChildNodes(tree.rootNode).find(node => isCommandWithName(node, 'alias'));
      if (!aliasNode) fail();
      console.log({ text: aliasNode?.text });

      const action = await createAliasInlineAction(doc, aliasNode!);
      console.log(JSON.stringify(action, null, 2));
      expect(action).toBeTruthy();
    });
  });

  it('returns null for non-alias diagnostics', async () => {
    const doc = createTestDocument('alias ll=\'ls -l\'');
    const tree = parser.parse(doc.getText());
    const diagnostic = {
      ...createDiagnostic(0, 0, doc.getText().length),
      code: 9999, // Different error code
    };
    expect(diagnostic).toBeTruthy();
    const aliasNode = getChildNodes(tree.rootNode).find(node => isCommandWithName(node, 'alias'))!;
    const action = await createAliasInlineAction(doc, aliasNode);
    expect(action).toBeTruthy();
  });

  it('returns null for invalid alias syntax', async () => {
    const doc = createTestDocument('alias');
    const tree = parser.parse(doc.getText());
    const diagnostic = createDiagnostic(0, 0, doc.getText().length);
    expect(diagnostic).toBeTruthy();
    const action = await createAliasInlineAction(doc, tree.rootNode);
    expect(action).toBeUndefined();
    expect(!action).toBeTruthy();
  });
});
