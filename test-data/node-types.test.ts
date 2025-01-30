import Parser, { SyntaxNode } from 'web-tree-sitter';
import { initializeParser } from '../src/parser';
import { findFirstSibling, getChildNodes } from '../src/utils/tree-sitter';
import * as NodeTypes from '../src/utils/node-types';
// import { assert } from 'chai';

function parseStringForNodeType(str: string, predicate: (n: SyntaxNode) => boolean) {
  const tree = parser.parse(str);
  const root = tree.rootNode;
  return getChildNodes(root).filter(predicate);
}

function skipSetQuery(node: SyntaxNode) {
  let current: SyntaxNode | null = node;
  while (current && !NodeTypes.isCommand(current)) {
    if (current.text === '-q' || current.text === '--query') {
      return true;
    }
    current = current.previousSibling;
  }
  return false;
}

/*
 * get first sibling
 */
function walkUpSiblings(n: SyntaxNode) {
  let currentNode = n;
  while (currentNode.previousSibling !== null) {
    currentNode = currentNode.previousSibling;
  }
  return currentNode;
}

function walkUpAndGather(n: SyntaxNode, predicate: (_: SyntaxNode) => boolean) {
  const result: SyntaxNode[] = [];
  let currentNode: SyntaxNode | null = n;
  while (currentNode !== null) {
    if (!predicate(currentNode)) break;
    result.unshift(currentNode);
    currentNode = currentNode.previousNamedSibling;
  }
  return result;
}

function logNode(nodeName: string, text: string, type: string, isNamed: boolean) {
  console.log({ name: nodeName, text, type, isNamed });
}

function logNodes(nodes: SyntaxNode[]) {
  nodes.forEach(n => console.log(n.text));
}

let parser: Parser;
const jestConsole = console;

beforeEach(async () => {
  parser = await initializeParser();
  global.console = require('console');
});

afterEach(() => {
  global.console = jestConsole;
  if (parser) parser.delete();
});

describe('node-types tests', () => {
  /**
     * NOTICE: isCommand vs isCommandName
     */
  it('isCommand', () => {
    const commands = parseStringForNodeType('echo "hello world"', NodeTypes.isCommand);
    //logNodes(commands)
    expect(commands[0]?.text).toEqual('echo "hello world"');
  });

  it('isCommandName', () => {
    const commandsName = parseStringForNodeType('echo "hello world"', NodeTypes.isCommandName);
    //logNodes(commandsName)
    expect(commandsName[0]?.text).toEqual('echo');
  });

  it('isComment', () => {
    const comments = parseStringForNodeType('# this is a comment', NodeTypes.isComment);
    //logNodes(comments)
    expect(comments[0]?.text).toEqual('# this is a comment');

    const multiComments = parseStringForNodeType([
      '# line 1',
      '# line 2',
      '# line 3',
      'set -l value',
    ].join('\n'), NodeTypes.isComment);

    expect(multiComments.length).toBe(3);
  });

  it('isShebang', () => {
    const testString = [
      '#!/usr/local/bin/env fish',
      '# this is a comment',
      '#!/usr/bin/fish',
    ].join('\n');
    const shebang = parseStringForNodeType(testString, NodeTypes.isShebang);
    const comments = parseStringForNodeType(testString, NodeTypes.isComment);
    //logNodes(shebang)
    //logNodes(comments)
    expect(shebang.length).toBe(1);
    expect(comments.length).toBe(2);
  });

  it('isProgram', () => {
    const emptyText = parseStringForNodeType('', NodeTypes.isProgram);
    expect(emptyText.length).toBe(1);

    // program === tree.rootNode
    const input = 'echo "hello world"';
    const root = parser.parse(input).rootNode!;
    const program = parseStringForNodeType(input, NodeTypes.isProgram);
    expect(program[0]?.text).toEqual(root.text);
  });

  it('isStatement', () => {
    /**
         * checks for 5 different kinds of statements ->
         *    for_statement, while_statement, if_statement, switch_statement, begin_statement
         */
    const input = [
      'for i in (seq 1 10); echo $i; end;',
      'while read -S line; echo $line;end;',
      'if test -f $file; echo "file exists"; else; echo "file does not exist";end;',
      'switch $var; case 1; echo "one"; case 2; echo "two"; case 3; echo "three"; end;',
      'begin; echo "hello world"; end;',
    ].join('\n');
    const statement = parseStringForNodeType(input, NodeTypes.isStatement);
    //logNodes(statement)
    expect(statement.length).toBe(5);
  });

  it('isEnd', () => {
    const input = [
      'for i in (seq 1 10); echo $i; end;',
      'while read -S line; echo $line;end;',
      'if test -f $file; echo "file exists"; else; echo "file does not exist";end;',
      'switch $var; case 1; echo "one"; case 2; echo "two"; case 3; echo "three"; end;',
      'begin; echo "hello world"; end;',
    ].join('\n');
    const ends = parseStringForNodeType(input, NodeTypes.isEnd);
    //logNodes(ends)
    expect(ends.length).toBe(5);
  });

  it('isString', () => {
    const input = [
      'echo "hello world"',
      'echo \'hello world\'',
    ].join('\n');
    const strings = parseStringForNodeType(input, NodeTypes.isString);
    //logNodes(strings)
    expect(strings.length).toBe(2);
  });

  it('isReturn', () => {
    const input = [
      'function false',
      '    return 1',
      'end',
    ].join('\n');
    const returns = parseStringForNodeType(input, NodeTypes.isReturn);
    //logNodes(returns)
    expect(returns.length).toBe(1);
  });

  /**
     * NOTICE: isFunctionDefinitionName vs isFunctionDefinition
     */
  it('isFunctionDefinition', () => {
    const input = [
      'function foo; echo "hello world"; end;',
      'function foo_2',
      '    function foo_2_inner',
      '        echo "hello world"',
      '    end',
      '    foo_2_inner',
      'end',
    ].join('\n');
    const functionDefinitions = parseStringForNodeType(input, NodeTypes.isFunctionDefinition);
    //logNodes(functionDefinitions)
    expect(functionDefinitions.length).toBe(3);
  });

  it('isFunctionDefinitionName', () => {
    const input = [
      'function foo; echo "hello world"; end;',
      'function foo_2',
      '    function foo_2_inner',
      '        echo "hello world"',
      '    end',
      '    foo_2_inner',
      'end',
    ].join('\n');
    const functionDefinitionNames = parseStringForNodeType(input, NodeTypes.isFunctionDefinitionName);
    //logNodes(functionDefinitionNames)
    expect(functionDefinitionNames.length).toBe(3);
    expect(functionDefinitionNames.map(n => n.text)).toEqual(['foo', 'foo_2', 'foo_2_inner']);
  });

  // TODO
  it('isVariableDefinitionCommand', () => {
    const input = [
      'set -x set_foo 1',
      'echo "hi" | read read_foo',
      'function func_foo -a func_foo_arg',
      '    echo $func_foo_arg',
      'end',
      'set -gx OS_NAME (set -l f "v" | echo $v) # check for mac or linux',
    ].join('\n');
    const variableDefinitions = parseStringForNodeType(input, NodeTypes.isDefinition);
    expect(
      variableDefinitions.map((v) => v.text),
    ).toEqual(
      ['set_foo', 'read_foo', 'func_foo', 'func_foo_arg', 'OS_NAME', 'f'],
    );
  });

  it('isVariableDef', () => {
    const input = [
      'set -x set_foo 1',
      'set -q local_foo 2',
      'function _f -a param_foo;end;',
      'for i in (seq 1 10); echo $i; end;',
      'echo \'var\' | read -l read_foo',
    ].join('\n');
    const defs = parseStringForNodeType(input, NodeTypes.isVariableDefinition);
    const result: SyntaxNode[] = [];
    defs.forEach(def => {
      const cmd = NodeTypes.findParentCommand(def)!;
      const firstCmdText = cmd?.firstChild?.text;
      // console.log('text: ', firstCmdText)
      if (!cmd) {
        result.push(def);
        return;
      }
      if (firstCmdText !== 'set') {
        result.push(def);
        return;
      }
      if (skipSetQuery(def)) return;
      result.push(def);
    });
    expect(result.map(d => d.text)).toEqual(['set_foo', 'param_foo', 'i', 'read_foo']);
  });

  it('isStatement "if" "else-if" "else"', () => {
    const input = [
      'set out_of_scope',
      'if true',
      '    set out_of_scope true',
      'else if false',
      '    set out_of_scope false',
      'else',
      '    set --erase out_of_scope',
      'end',
    ].join('\n');
    const nodes = parseStringForNodeType(input, NodeTypes.isStatement);
    expect(nodes.length).toBe(1);
  });

  it('isBlock "if" "else-if" "else"', () => {
    const input = [
      'set out_of_scope',
      'if true',
      '    set out_of_scope true',
      'else if false',
      '    set out_of_scope false',
      'else',
      '    set --erase out_of_scope',
      'end',
    ].join('\n');
    const nodes = parseStringForNodeType(input, NodeTypes.isBlock);
    // console.log(nodes.length);
    expect(nodes.length).toBe(3);
  });

  it('isClause/isCaseClause "switch" "case" "case" "case"', () => {
    const input = [
      'set os_name (uname -o)',
      'switch "$os_name"',
      '    case \'GNU/Linux\'',
      '        echo \'good\'',
      '    case \'OSX\'',
      '        echo \'mid\'',
      '    case \'Windows\'',
      '        echo \'bad\'',
      'end',
    ].join('\n');

    const clause_nodes = parseStringForNodeType(input, NodeTypes.isClause);
    expect(clause_nodes.length).toBe(3);

    const case_nodes = parseStringForNodeType(input, NodeTypes.isCaseClause);
    expect(case_nodes.length).toBe(3);
  });

  it('isStringCharacter "" \'\'', () => {
    const input = [
      'set os_name (uname -o)',
      'switch "$os_name"',
      '    case \'GNU/Linux\'',
      '        echo \'good\'',
      '    case \'OSX\'',
      '        echo \'mid\'',
      '    case \'Windows\'',
      '        echo \'bad\'',
      'end',
    ].join('\n');

    const stringCharNodes = parseStringForNodeType(input, NodeTypes.isStringCharacter);
    expect(stringCharNodes.length).toBe(14);
  });

  it('isString "" \'\'', () => {
    const input = [
      'set os_name (uname -o)',
      'switch "$os_name"',
      '    case \'GNU/Linux\'',
      '        echo \'good\'',
      '    case \'OSX\'',
      '        echo \'mid\'',
      '    case \'Windows\'',
      '        echo \'bad\'',
      'end',
    ].join('\n');

    const stringNodes = parseStringForNodeType(input, NodeTypes.isString);
    expect(stringNodes.length).toBe(7);
  });

  it('isEnd "for" "if"', () => {
    const endNodes = parseStringForNodeType([
      'for i in (seq 1 10)',
      '     echo $i',
      'end',
      'if true',
      '     echo "false"',
      'end',
    ].join('\n'), NodeTypes.isEnd);
    expect(endNodes.length).toBe(2);
  });

  it('isNewline "for" "if"', () => {
    const endNodes = parseStringForNodeType([
      'for i in (seq 1 10)',
      '     echo $i',
      'end',
      'if true',
      '     echo "false"',
      'end',
    ].join('\n'), NodeTypes.isNewline);
    expect(endNodes.length).toBe(5);
  });

  it('isSemiColon', () => {
    const colonNodes = parseStringForNodeType([
      'begin;',
      '    if test \'$HOME\' = (pwd); and string match -re \'/home/username\' "$HOME" ',
      '         echo \'in your home directory\'; and return 0',
      '    end',
      'end;',

    ].join('\n'), NodeTypes.isSemicolon);
    expect(colonNodes.length).toBe(4);
  });

  it('isReturn', () => {
    const returnNodes = parseStringForNodeType([
      'function t_or_f',
      '     if test "$argv" = \'t\'',
      '         return 0',
      '     end',
      '     return 1',
      'end',
    ].join('\n'), NodeTypes.isReturn);

    expect(returnNodes.length).toBe(2);
  });

  it('isIfOrElseIfConditional "if" "else-if" "else"', () => {
    const condNodes = parseStringForNodeType([
      'function t_or_f',
      '     if test "$argv" = \'t\'',
      '         return 0',
      '     else if test -n "$argv"',
      '         return 0',
      '     else',
      '         return 1',
      '     end',
      'end',
    ].join('\n'), NodeTypes.isIfOrElseIfConditional);
    expect(condNodes.length).toBe(2);
  });

  it('isConditional "if" "else-if" "else"', () => {
    const condNodes = parseStringForNodeType([
      'function t_or_f',
      '     if test "$argv" = \'t\'',
      '         return 0',
      '     else if test -n "$argv"',
      '         return 0',
      '     else',
      '         return 1',
      '     end',
      'end',
    ].join('\n'), NodeTypes.isConditional);
    expect(condNodes.length).toBe(3);
  });

  it('isOption "set --global --export --append PATH $HOME/.local/bin"; "set -gxa PATH $HOME/.cargo/bin"', () => {
    const input = [
      'set --global --export --append $PATH $HOME/.local/bin',
      'set -gxa PATH $HOME/.cargo/bin',
    ].join('\n');
    const allOptionNodes = parseStringForNodeType(input, NodeTypes.isOption);
    expect(allOptionNodes.length).toBe(4);
    expect(allOptionNodes.map(n => n.text)).toEqual(['--global', '--export', '--append', '-gxa']);

    const longOptionNodes = parseStringForNodeType(input, NodeTypes.isLongOption);
    expect(longOptionNodes.map(n => n.text)).toEqual(['--global', '--export', '--append']);

    const shortOptionNodes = parseStringForNodeType(input, NodeTypes.isShortOption);
    expect(shortOptionNodes.map(n => n.text)).toEqual(['-gxa']);
  });

  it('isShortOption [WITH CHAR]', () => {
    const shortOptionNodes = parseStringForNodeType('set -gxa PATH $HOME/.cargo/bin', NodeTypes.isShortOption);
    expect(shortOptionNodes.map(n => n.text)).toEqual(['-gxa']);

    const joinedShortNodes = parseStringForNodeType('set -gxa PATH $HOME/.cargo/bin', NodeTypes.isJoinedShortOption);
    expect(joinedShortNodes.map(n => n.text)).toEqual(['-gxa']);

    const globalOption = (n: SyntaxNode) => NodeTypes.hasShortOptionCharacter(n, 'g');
    const exportOption = (n: SyntaxNode) => NodeTypes.hasShortOptionCharacter(n, 'x');
    const appendOption = (n: SyntaxNode) => NodeTypes.hasShortOptionCharacter(n, 'a');
    const hasAllThreeOptions = (n: SyntaxNode) => {
      return globalOption(n) || exportOption(n) || appendOption(n);
    };
    expect(parseStringForNodeType('set -gxa PATH $HOME/.cargo/bin', (n: SyntaxNode) => hasAllThreeOptions(n))).toBeTruthy();
  });

  it('isMatchingOption', () => {
    expect([
      ...parseStringForNodeType('set -gxa PATH $HOME/.cargo/bin', (n: SyntaxNode) => NodeTypes.isMatchingOption(n, { shortOption: '-g' })),
      ...parseStringForNodeType('set -gxa PATH $HOME/.cargo/bin', (n: SyntaxNode) => NodeTypes.isMatchingOption(n, { shortOption: '-x' })),
      ...parseStringForNodeType('set -gxa PATH $HOME/.cargo/bin', (n: SyntaxNode) => NodeTypes.isMatchingOption(n, { shortOption: '-a' })),
    ].map(n => n.text)).toEqual(['-gxa', '-gxa', '-gxa']);

    const oldFlag = parseStringForNodeType('find -type d', (n: SyntaxNode) => NodeTypes.isMatchingOption(n, { oldUnixOption: '-type' }));
    expect(oldFlag.map(n => n.text)).toEqual(['-type']);

    expect(
      parseStringForNodeType(
        'set --global PATH /bin',
        (n: SyntaxNode) => NodeTypes.isMatchingOption(n, { longOption: '--global' }),
      ).map(n => n.text),
    ).toEqual(['--global']);

    const longOpt = parseStringForNodeType('command ls --ignore=\'install_scripts\'', (n: SyntaxNode) => NodeTypes.isMatchingOption(n, { longOption: '--ignore' }));
    expect(
      longOpt.map(n => n.text.slice(0, n.text.indexOf('='))),
    ).toEqual(['--ignore', '--ignore']);
  });

  it('isEndStdinCharacter `string match --regex --entire  -- \'^\w+\s\w*\' "$argv"`', () => {
    const charNodes = parseStringForNodeType('string match --regex --entire  -- \'^\w+\s\w*\' "$argv"', NodeTypes.isEndStdinCharacter);
    expect(charNodes.length).toBe(1);
  });

  it('isScope "program" "function" "for" "if" "else-if" "else" "switch" "case" "case"', () => {
    const scopeNodes = parseStringForNodeType([
      'function inner_function',
      '     for i in (seq 1 10)',
      '          echo $i',
      '     end',
      '     if test "$argv" = \'t\'',
      '         echo 0',
      '     else if test -n "$argv"',
      '         echo 0',
      '     else',
      '         echo 1',
      '     end',
      '     switch "$argv"',
      '         case "-*"',
      '             return 1',
      '         case "*"',
      '             return 0',
      '     end',
      'end',
    ].join('\n'), NodeTypes.isScope);
    expect(scopeNodes.map(n => n.type)).toEqual([
      'program',
      'function_definition',
      'for_statement',
      'if_statement',
      'switch_statement',
    ]);
  });

  it('isString() -> string values `argparse "h/help" "v/value" -- $argv`', () => {
    // const stringNodes = parseStringForNodeType([
    //   'argparse "h/help" "v/value" -- $argv',
    //   'or return'
    // ].join('\n'), NodeTypes.isString)
    // stringNodes.forEach(s => {
    //   console.log(s.text.slice(1, -1).split('/'));
    // })

    const argParseNodes = parseStringForNodeType([
      'argparse "h/help" "v/value" "other-value" "special-value=?"-- $argv',
      'or return',
    ].join('\n'), (n: SyntaxNode) => {
      if (NodeTypes.findParentCommand(n)?.firstChild?.text === 'argparse') {
        return NodeTypes.isString(n);
      }
      return false;
    });
    const parsedStrs = argParseNodes.map(n => {
      const resultText = n.text.slice(1, -1);
      return resultText.includes('=')
        ? resultText.slice(0, resultText.indexOf('='))
        : resultText;
    });

    expect(parsedStrs).toEqual([
      'h/help',
      'v/value',
      'other-value',
      'special-value',
    ]);

    /**
     *
     */
  });

  it('findPreviousSibling() - with find multiline comments', () => {
    const [eNode, ...other] = parseStringForNodeType('set --local var a b c d e', (n: SyntaxNode) => n.text === 'e');
    const firstNode = walkUpSiblings(eNode!);
    expect(firstNode.text).toBe('set');

    /**
     * do previous sibling comment nodes
     */
    const commentNodes = parseStringForNodeType([
      '# comment a',
      '# comment b',
      '# comment c',
      'set -l abc',
    ].join('\n'), NodeTypes.isComment);

    let lastComment = commentNodes.pop()!;
    const commentArr = walkUpAndGather(lastComment, (n) => NodeTypes.isComment(n) || NodeTypes.isNewline(n));
    expect(
      commentArr.map(c => c.text),
    ).toEqual([
      '# comment a',
      '# comment b',
      '# comment c',
    ]);

    /*
     * parse the last comment from the string
     */
    lastComment = parseStringForNodeType([
      '# comment a',
      '# comment b',
      '# comment c',
      'set -l abc # comment to skip',
    ].join('\n'), NodeTypes.isComment).pop()!;
    expect(lastComment.text).toEqual('# comment to skip');

    /*
     * parse the last definition
     */
    const lastDefinition = parseStringForNodeType([
      '# comment a',
      '# comment b',
      '# comment c',
      'set -l abc # comment to skip',
    ].join('\n'), NodeTypes.isVariableDefinition).pop()!;
    expect(lastDefinition.text).toEqual('abc');

    /*
     * find the parent of the last definition
     */
    const lastDefinitionCmd = NodeTypes.findParentCommand(lastDefinition)!;
    expect(lastDefinitionCmd.text).toEqual('set -l abc');

    /*
     * the gathered comments of the last comment should just be
     * the last comment
     */
    expect(
      walkUpAndGather(
        lastComment,
        (n) => NodeTypes.isComment(n) || NodeTypes.isNewline(n),
      ).map(n => n.text),
    ).toEqual(['# comment to skip']);

    /*
     * the gathered comments of the lastDefinition should just be nothing
     * the lastDefinition's previous sibling is not a comment or newline char
     */
    expect(
      walkUpAndGather(
        lastDefinition,
        (n) => NodeTypes.isComment(n) || NodeTypes.isNewline(n),
      ).map(n => n.text),
    ).toEqual([]);

    /*
     * The gathered comments of the lastDefinitionCmd would also be empty because
     * it is a command (NOT A COMMENT).
     * However, the lastDefinitionCmd's previous sibling, should be a newline character
     * and previousNamedSibling should be .type 'comment'
     */
    expect(
      walkUpAndGather(
        lastDefinitionCmd.previousNamedSibling!,
        (n) => NodeTypes.isComment(n) || NodeTypes.isNewline(n),
      ).map(n => n.text),
    ).toEqual([
      '# comment a',
      '# comment b',
      '# comment c',
    ]);
  });

  it('walkUpAndGather - inline-comment on preceding line', () => {
    let node = parseStringForNodeType([
      'set -l a_1 "1" # preceding comment',
      'set --local a_2 "2"',
    ].join('\n'), (n: SyntaxNode) => n.text === 'a_2').pop()!;
    let commandNode = NodeTypes.findParentCommand(node)!;
    let currentNode: SyntaxNode | null = commandNode!.previousNamedSibling!;
    expect(
      walkUpAndGather(
        currentNode,
        (n) => !NodeTypes.isInlineComment(n) && (NodeTypes.isComment(n) || NodeTypes.isNewline(n)),
      ).map(n => n.text),
    ).toEqual([]);

    node = parseStringForNodeType([
      'set -l A_2 # preceding comment',
      '# comment a',
      '# comment b',
      'set -l a_1 "1" # preceding comment',
      'set --local a_2 "2"',
    ].join('\n'), (n: SyntaxNode) => n.text === 'a_1').pop()!;

    commandNode = NodeTypes.findParentCommand(node)!;
    currentNode = commandNode!.previousNamedSibling!;

    expect(
      walkUpAndGather(
        currentNode,
        (n) => !NodeTypes.isInlineComment(n) && (NodeTypes.isComment(n) || NodeTypes.isNewline(n)),
      ).map(n => n.text),
    ).toEqual([
      '# comment a',
      '# comment b',
    ]);
  });

  it('[REGEX FLAG] string match -re "^-.*" "$argv"', () => {
    const strNodes = parseStringForNodeType('string match -re "^-.*" "$argv"', NodeTypes.isString);
    const lastStrNode = strNodes.pop()!;
    const parentNode = NodeTypes.findParentCommand(lastStrNode);
    const regexOption = findFirstSibling(lastStrNode, n => NodeTypes.isMatchingOption(n, { shortOption: '-r', longOption: '--regex' }));
    // if (parentNode?.firstChild?.text === 'string' && regexOption) {
    //   console.log("found");
    // }
    expect(parentNode?.firstChild?.text === 'string' && regexOption).toBeTruthy();
  });

  it('for loop', () => {
    const input: string = [
      'for i in (seq 1 10)',
      '     echo $i',
      'end',
      'function a',
      '    for i in (seq 1 100)',
      '         echo $i',
      '    end',
      'end',
    ].join('\n');
    expect(parseStringForNodeType(input, NodeTypes.isForLoop).length).toBe(2);
    expect(parseStringForNodeType(input, NodeTypes.isVariableDefinition).length).toBe(2);

    /*
     * BOTH , '$i' (variable_expansion) and 'i' (variable) are valid in NodeTypes.isVariable()
     * i.e., `echo $i` creates both above types
     */
    expect(parseStringForNodeType(input, NodeTypes.isVariable).length).toBe(6);
  });

  /**
   * Diagnostic for string expansion inside quotes
   */
  it('[WARN] string check variables in quotes', () => {
    const strNodes = parseStringForNodeType([
      'set -l bad \'$argv\'',
      'set -l good "$argv"',
    ].join('\n'), NodeTypes.isString);
    expect(strNodes.length).toBe(2);

    const warnNodes: SyntaxNode[] = strNodes.filter(node => node.text.includes('$') && node.text.startsWith('\''));
    // for (const node of strNodes) {
    //   if (node.text.includes('$') && node.text.startsWith("'")) {
    //     console.log(node.text);
    //   }
    // }
    expect(warnNodes.length).toEqual(1);
  });

  it('check if $argv isFlagValue `test -z "$argv"`', () => {
    const optValues = parseStringForNodeType([
      'test -z "$argv"',
      // 'string split --field 2 "\\n" "h\\ni"',
      'abbr -a -g gsc --set-cursor=% \'git stash create \'%\'\'',
      'string split -f2 \' \' \'h  i\'',
    ].join('\n'), NodeTypes.isOption);

    const valueMatch = (parent: SyntaxNode, node: SyntaxNode) => {
      switch (parent.text) {
        case 'test':
          return NodeTypes.isMatchingOption(node, { shortOption: '-z' });
        case 'string':
          return NodeTypes.isMatchingOption(node, { shortOption: '-f', longOption: '--field' });
        case 'abbr':
          return NodeTypes.isMatchingOption(node, { longOption: '--set-cursor' });
        default:
          return null;
      }
    };

    optValues.forEach(o => {
      // console.log(o.text);
      const parentCmd = NodeTypes.findParentCommand(o)?.firstNamedChild;
      if (!parentCmd) {
        console.log('ERROR:', o.text);
        return;
      }
      const result = valueMatch(parentCmd, o)!;
      // console.log({result});

      /** continiue testing getArgumentValue(parent, argName)
        *                                             ^- refactor to `shortOption | longOption | oldOption`
        */
      // console.log(parentCmd.text, o.text, result);
    });
  });
});
