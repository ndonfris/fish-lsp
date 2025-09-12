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
// describe('createFunctionDefinition', () => {
//   //   const tests = [
//   //     {
//   //       name: 'basic ls alias',
//   //       aliasName: 'll',
//   //       command: 'ls -l',
//   //       expected: `function ll --wraps 'ls -l' --description "alias ll=ls -l"
//   //     ls -l $argv
//   // end`,
//   //       reason: 'should create basic function with wraps',
//   //     },
//   //     {
//   //       name: 'command needing builtin prefix',
//   //       aliasName: 'echo',
//   //       command: 'echo -n',
//   //       expected: `function echo --wraps 'echo -n' --description "alias echo=echo -n"
//   //     builtin echo -n $argv
//   // end`,
//   //       reason: 'should add builtin prefix for builtins',
//   //     },
//   //     {
//   //       name: 'command needing command prefix',
//   //       aliasName: 'ls',
//   //       command: 'ls -la',
//   //       expected: `function ls --wraps 'ls -la' --description "alias ls=ls -la"
//   //     command ls -la $argv
//   // end`,
//   //       reason: 'should add command prefix for same-named commands',
//   //     },
//   //     {
//   //       name: 'command with single quotes',
//   //       aliasName: 'say',
//   //       command: "echo 'hello world'",
//   //       expected: `function say --wraps 'echo \\'hello world\\'' --description "alias say=echo \\'hello world\\'"
//   //     echo 'hello world' $argv
//   // end`,
//   //       reason: 'should properly escape single quotes',
//   //     },
//   //     {
//   //       name: 'command with double quotes',
//   //       aliasName: 'greet',
//   //       command: 'echo "hello world"',
//   //       expected: `function greet --wraps 'echo "hello world"' --description "alias greet=echo \\"hello world\\""
//   //     echo "hello world" $argv
//   // end`,
//   //       reason: 'should properly escape double quotes',
//   //     },
//   //     {
//   //       name: 'recursive command skipping wraps',
//   //       aliasName: 'foo',
//   //       command: 'foo bar',
//   //       expected: `function foo --description "alias foo=foo bar"
//   //     command foo bar $argv
//   // end`,
//   //       reason: 'should skip wraps and add command prefix for recursive commands',
//   //     },
//   //     {
//   //       name: 'sudo command with recursive part',
//   //       aliasName: 'update',
//   //       command: 'sudo update',
//   //       expected: `function update --description "alias update=sudo update"
//   //     sudo update $argv
//   // end`,
//   //       reason: 'should skip wraps for sudo recursion',
//   //     },
//   //     {
//   //       name: 'command with multiple options',
//   //       aliasName: 'grep',
//   //       command: 'grep --color=auto --line-number',
//   //       expected: `function grep --wraps 'grep --color=auto --line-number' --description "alias grep=grep --color=auto --line-number"
//   //     command grep --color=auto --line-number $argv
//   // end`,
//   //       reason: 'should handle multiple command options',
//   //     },
//   //     {
//   //       name: 'command with backslashes',
//   //       aliasName: 'search',
//   //       command: 'find . -name "\\*.txt"',
//   //       expected: `function search --wraps 'find . -name "\\*.txt"' --description "alias search=find . -name \\"\\\\*.txt\\""
//   //     find . -name "\\*.txt" $argv
//   // end`,
//   //       reason: 'should preserve backslashes in command but escape in description',
//   //     },
//   //     {
//   //       name: 'command with pipes',
//   //       aliasName: 'count',
//   //       command: 'wc -l | sort -n',
//   //       expected: `function count --wraps 'wc -l | sort -n' --description "alias count=wc -l | sort -n"
//   //     wc -l | sort -n $argv
//   // end`,
//   //       reason: 'should handle pipes correctly',
//   //     },
//   //     {
//   //       name: 'command with special characters',
//   //       aliasName: 'list_all',
//   //       command: 'ls -la && echo "Done!"',
//   //       expected: `function list_all --wraps 'ls -la && echo "Done!"' --description "alias list_all=ls -la && echo \\"Done!\\""
//   //     ls -la && echo "Done!" $argv
//   // end`,
//   //       reason: 'should handle special shell characters',
//   //     },
//   //   ];
//   //
//   //   tests.forEach(({ name, aliasName, command, expected, reason }) => {
//   //     it(`${name} - ${reason}`, () => {
//   //       const result = AliasHelper.extractFunctionName.(command);
//   //       console.log({ name, result, expected });
//   //       // expect(result).toBe(expected);
//   //     });
//   //   });
//   //
//   // describe('error handling', () => {
//   //   it('handles empty command', () => {
//   //     const result = createFunctionDefinition('test', '');
//   //     expect(result).toContain('function test');
//   //   });
//   //
//   //   it('handles empty alias name', () => {
//   //     const result = createFunctionDefinition('', 'ls -l');
//   //     expect(result).toContain('function');
//   //   });
//   //
//   //   it('handles only spaces', () => {
//   //     const result = createFunctionDefinition('test', '   ');
//   //     expect(result).toContain('function test');
//   //   });
//   // });
// });

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

  // it('basic alias with equals', () => {
  //   const doc = createTestDocument('alias ll=\'ls -l\'');
  //   const tree = parser.parse(doc.getText());
  //
  //   const info = isCommandWithName(tree.rootNode, 'alias');
  //   expect(info).not.toBeNull();
  //   if (!info) fail();
  //
  //   const { command, value } = AliasHelper.extractAliasInfo(info);
  //   expect(command).toEqual('ll');
  //   expect(value).toEqual('ls -l');
  // });
  //
  // it('determinePrefix', () => {
  //   // builtins
  //   [
  //     determinePrefix('echo', 'echo -n'),
  //     determinePrefix('bind', 'bind foo'),
  //     determinePrefix('type', 'type -a'),
  //     determinePrefix('abbr', 'abbr -a'),
  //     determinePrefix('complete', 'complete -c'),
  //     determinePrefix('if', 'if true'),
  //     determinePrefix('while', 'while true'),
  //     determinePrefix('for', 'for x in y'),
  //     determinePrefix('function', 'function foo'),
  //     determinePrefix('set_color', 'set_color blue'),
  //   ].forEach(prefix => expect(prefix).toEqual('builtin'));
  //
  //   // commands
  //   [
  //     determinePrefix('bash', 'bash -c "echo hello"'),
  //     determinePrefix('ls', 'ls -l'),
  //     determinePrefix('man', 'man ls'),
  //   ].forEach(prefix => expect(prefix).toEqual('command'));
  // });
  //
  // it('shouldAddWraps', () => {
  //   // Should add wraps
  //   [
  //     shouldAddWraps('ll', 'ls -l'),
  //     shouldAddWraps('gc', 'git commit'),
  //     shouldAddWraps('echo2', 'echo "hello world"'),
  //   ].forEach(addWraps => expect(addWraps).toBe(true));
  //
  //   // Should not add wraps
  //   [
  //     shouldAddWraps('foo', 'foo bar'),
  //     shouldAddWraps('foo', 'bar foo'),
  //     shouldAddWraps('grep', 'grep --color'),
  //   ].forEach(addWraps => expect(addWraps).toBe(false));
  // });
  //
  // // it("createFunctionDefinition", () => {
  // //   [
  // //     createFunctionDefinition('ll', 'ls -l'),
  // //   ]
  // //
  // //
  // // }});

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

    // it(name, () => {
    //   const doc = createTestDocument(input);
    //   const tree = parser.parse(input);
    //   const diagnostic = createDiagnostic(0, 0, input.length);
    //
    //   const action = convertAliasToFunction(diagnostic, tree.rootNode, doc);
    //
    //   // Verify action was created
    //   expect(action).not.toBeNull();
    //   expect(action!.edit!.changes).toBeDefined();
    //
    //   if (action?.edit?.changes === undefined || action?.edit?.changes[doc.uri] === undefined) {
    //     fail();
    //   }
    //
    //   // Get the edit content
    //   const edits = action?.edit?.changes[doc.uri] as TextEdit[];
    //   expect(edits).toHaveLength(1);
    //
    //   // Compare the result
    //   expect(edits[0]?.newText).toEqual(expected);
    // });
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
