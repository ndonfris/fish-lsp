import * as Parser from 'web-tree-sitter';
import path from 'path';
import { SyntaxNode } from 'web-tree-sitter';
import { initializeParser } from '../src/parser';
import { findFirstSibling, getChildNodes } from '../src/utils/tree-sitter';
import * as NodeTypes from '../src/utils/node-types';
import { PrebuiltDocumentationMap } from '../src/utils/snippets';
import { getPrebuiltVariableExpansionDocs, isPrebuiltVariableExpansion } from '../src/hover';
import { AutoloadedPathVariables, setupProcessEnvExecFile } from '../src/utils/process-env';
import { FishAlias, FishAliasInfoType } from '../src/parsing/alias';
import { createFakeLspDocument } from './helpers';
import { Option } from '../src/parsing/options';
import { processArgparseCommand } from '../src/parsing/argparse';
import { env } from '../src/utils/env-manager';
import { isAliasDefinitionName } from '../src/parsing/alias';
import { fail } from 'assert';
import { Analyzer } from '../src/analyze';
import { setLogger } from './helpers';
import { logger } from '../src/logger';

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

let parser: Parser;

describe('node-types tests', () => {
  beforeAll(async () => {
    parser = await initializeParser();
    setLogger();
    logger.allowDefaultConsole();
    await Analyzer.initialize();
    await setupProcessEnvExecFile();
    env.append('fish_complete_path', path.join(__dirname, 'workspaces', 'workspace_1', 'fish', 'completions'));
    env.append('fish_function_path', path.join(__dirname, 'workspaces', 'workspace_1', 'fish', 'functions'));
    env.append('fish_user_paths', path.join(__dirname, 'workspaces', 'workspace_1', 'fish'));
  });

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
      ...parseStringForNodeType('set -gxa PATH $HOME/.cargo/bin', (n: SyntaxNode) => NodeTypes.isMatchingOption(n, Option.short('-g'))),
      ...parseStringForNodeType('set -gxa PATH $HOME/.cargo/bin', (n: SyntaxNode) => NodeTypes.isMatchingOption(n, Option.short('-x'))),
      ...parseStringForNodeType('set -gxa PATH $HOME/.cargo/bin', (n: SyntaxNode) => NodeTypes.isMatchingOption(n, Option.short('-a'))),
    ].map(n => n.text)).toEqual(['-gxa', '-gxa', '-gxa']);

    const oldFlag = parseStringForNodeType('find -type d', (n: SyntaxNode) => NodeTypes.isMatchingOption(n, Option.unix('-type')));
    expect(oldFlag.map(n => n.text)).toEqual(['-type']);

    expect(
      parseStringForNodeType(
        'set --global PATH /bin',
        (n: SyntaxNode) => NodeTypes.isMatchingOption(n, Option.long('--global')),
      ).map(n => n.text),
    ).toEqual(['--global']);

    const longOpt = parseStringForNodeType('command ls --ignore=\'install_scripts\'', (n: SyntaxNode) => NodeTypes.isMatchingOption(n, Option.long('--ignore')));
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
    const regexOption = findFirstSibling(lastStrNode, n => NodeTypes.isMatchingOption(n, Option.create('-r', '--regex')));
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
          return NodeTypes.isMatchingOption(node, Option.short('-z'));
        case 'string':
          return NodeTypes.isMatchingOption(node, Option.create('-f', '--field').withValue());
        case 'abbr':
          return NodeTypes.isMatchingOption(node, Option.long('--set-cursor').withOptionalValue());
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

  describe('alias symbols', () => {
    it('isAliasName(node: SyntaxNode)', () => {
      const aliasNames = parseStringForNodeType([
        'alias gsc="git stash create"',
        'alias g="git"',
        'alias ls "ls -1"',
        'alias lsd "ls -1"',
        'alias funky="echo $PATH && ls"',
        'alias echo-quote="echo \\"hello world\\""',
      ].join('\n'), isAliasDefinitionName);
      // console.log(aliasNames.map(n => n.text));
      expect(aliasNames.map(n => n.text.split('=').at(0))).toEqual(['gsc', 'g', 'ls', 'lsd', 'funky', 'echo-quote']);
    });

    it('check for alias definition', () => {
      const testInfo = [
        {
          input: 'alias g="git"',
          output: {
            name: 'g',
            value: 'git',
            prefix: '',
            wraps: 'git',
            hasEquals: true,
          },
        },
        {
          input: 'alias ls "ls -1"',
          output: {
            name: 'ls',
            value: 'ls -1',
            prefix: 'command',
            wraps: null,
            hasEquals: false,
          },
        },
        {
          input: "alias fdf 'fd --hidden | fzf'",
          output: {
            name: 'fdf',
            value: 'fd --hidden | fzf',
            prefix: '',
            wraps: 'fd --hidden | fzf',
            hasEquals: false,
          },
        },
        {
          input: "alias fzf='fzf --height 40%'",
          output: {
            name: 'fzf',
            value: 'fzf --height 40%',
            prefix: 'command',
            wraps: null,
            hasEquals: true,
          },
        },
        {
          input: "alias grep='grep --color=auto'",
          output: {
            name: 'grep',
            value: 'grep --color=auto',
            prefix: 'command',
            wraps: null,
            hasEquals: true,
          },
        },
        {
          input: "alias rm='rm -i'",
          output: {
            name: 'rm',
            value: 'rm -i',
            prefix: 'command',
            wraps: null,
            hasEquals: true,
          },
        },
      ];

      const results: FishAliasInfoType[] = [];
      testInfo.forEach(({ input, output }) => {
        const { rootNode } = parser.parse(input);
        for (const child of getChildNodes(rootNode)) {
          if (NodeTypes.isCommandWithName(child, 'alias')) {
            const info = FishAlias.getInfo(child);
            if (!info) fail();
            results.push(info);
            expect(info).toEqual(output);
          }
        }
      });
      expect(results.length).toBe(6);
    });

    it('alias function outputs', () => {
      const testInfo = [
        {
          input: 'alias gsc="git stash create"',
          output: "function gsc --wraps='git stash create' --description 'alias gsc=git stash create'\n" +
            '    git stash create $argv\n' +
            'end',
        },
        {
          input: 'alias g="git"',
          output: "function g --wraps='git' --description 'alias g=git'\n    git $argv\nend",
        },
        {
          input: "alias ls 'exa --group-directories-first --icons --color=always -1 -a'",
          output: "function ls --wraps='exa --group-directories-first --icons --color=always -1 -a' --description 'alias ls exa --group-directories-first --icons --color=always -1 -a'\n" +
            '    exa --group-directories-first --icons --color=always -1 -a $argv\n' +
            'end',
        },
        {
          input: "alias lsd 'exa --group-directories-first --icons --color=always -a'",
          output: "function lsd --wraps='exa --group-directories-first --icons --color=always -a' --description 'alias lsd exa --group-directories-first --icons --color=always -a'\n" +
            '    exa --group-directories-first --icons --color=always -a $argv\n' +
            'end',
        },
        {
          input: "alias exa 'exa --group-directories-first --icons --color=always -1 -a'",
          output: "function exa --description 'alias exa exa --group-directories-first --icons --color=always -1 -a'\n" +
            '    command exa --group-directories-first --icons --color=always -1 -a $argv\n' +
            'end',
        },
        {
          input: "alias funky='echo $PATH && ls'",
          output: "function funky --wraps='echo $PATH && ls' --description 'alias funky=echo $PATH && ls'\n" +
            '    echo $PATH && ls $argv\n' +
            'end',
        },
        {
          input: "alias echo-quote='echo \"hello world\"'",
          output: "function echo-quote --wraps='echo \"hello world\"' --description 'alias echo-quote=echo \"hello world\"'\n" +
            '    echo "hello world" $argv\n' +
            'end',
        },
      ];

      testInfo.forEach(({ input, output }) => {
        const { rootNode } = parser.parse(input);
        const aliasCommandNode = getChildNodes(rootNode).find(child => NodeTypes.isCommandWithName(child, 'alias'))!;
        if (!aliasCommandNode) {
          fail();
        }
        const result = FishAlias.toFunction(aliasCommandNode);
        // console.log(result);
        expect(result).toEqual(output);
      });
    });

    //     it('alias SymbolDefinition', () => {
    //       const testInfo = [
    //         {
    //           filename: 'conf.d/aliases.fish',
    //           input: 'alias gsc="git stash create"',
    //           expected: {
    //             name: 'gsc',
    //             kind: SymbolKind.Function,
    //             text: [
    //
    //               `(${md.italic('alias')}) ${'gsc'}`,
    //               md.separator(),
    //               md.codeBlock('fish', 'alias gsc="git stash create"'),
    //               md.separator(),
    //               md.codeBlock('fish', 'function gsc --wraps=\'git stash create\' --description \'alias gsc=git stash create\'\n    git stash create $argv\nend'),
    //             ].join('\n'),
    //             selectionRange: {
    //               start: { line: 0, character: 6 },
    //               end: { line: 0, character: 9 },
    //             },
    //             scope: 'global',
    //           },
    //         },
    //         {
    //           filename: 'functions/foo.fish',
    //           input: `function foo
    //     alias foo_alias="echo 'foo alias'"
    // end
    //
    // function bar
    //     alias bar_alias "echo 'bar alias'"
    // end
    // `,
    //           expected: {
    //             name: 'foo_alias',
    //             kind: SymbolKind.Function,
    //             text: [
    //
    //               `(${md.italic('alias')}) ${'foo_alias'}`,
    //               md.separator(),
    //               md.codeBlock('fish', 'alias foo_alias="echo \'foo alias\'"'),
    //               md.separator(),
    //               md.codeBlock('fish', 'function foo_alias --wraps=\'echo \\\'foo alias\\\'\' --description \'alias foo_alias=echo \\\'foo alias\\\'\'\n    echo \'foo alias\' $argv\nend'),
    //             ].join('\n'),
    //             selectionRange: {
    //               start: { line: 1, character: 10 },
    //               end: { line: 1, character: 19 },
    //             },
    //             scope: 'local',
    //           },
    //         },
    //       ];
    //
    //       function resultToExpected(result: FishSymbol): any {
    //         return {
    //           name: result.name,
    //           kind: result.kind,
    //           text: result.detail,
    //           selectionRange: result.selectionRange,
    //           scope: result.scope.scopeTag.toString(),
    //         };
    //       }
    //
    //       testInfo.forEach(({ filename, input, expected }) => {
    //         const doc = createFakeLspDocument(filename, input);
    //         const { rootNode } = parser.parse(doc.getText());
    //         const aliasNode = getChildNodes(rootNode).find(child => NodeTypes.isAliasName(child))!;
    //         if (!aliasNode) {
    //           fail();
    //         }
    //         // console.log(getScope(doc, aliasNode), doc.uri);
    //         const result = FishAlias.toFishDocumentSymbol(
    //           aliasNode,
    //           aliasNode.parent!,
    //           doc,
    //         );
    //         // console.log(result);
    //         if (!result) fail();
    //         // console.log(result.scope.scopeNode.text);
    //         expect(resultToExpected(result)).toEqual(expected);
    //       });
    //     });
  });

  it.skip('find $status hover', () => {
    const { rootNode } = parser.parse(`
function foo
    echo a
    echo b
    echo c
    echo d
    echo $status

    if test -n "$argv"
        echo $status
    end

    if test "$argv" = "test"
        pritnf %s "$status"
    end
    echo $status
end
`);
    // const results: SyntaxNode[] = [];
    // console.log(PrebuiltDocumentationMap.getByType('variable').map(v => v.name));
    let idx = 0;
    for (const child of getChildNodes(rootNode)) {
      if (isPrebuiltVariableExpansion(child)) {
        if (PrebuiltDocumentationMap.getByName(child.text)) {
          const docs = getPrebuiltVariableExpansionDocs(child);
          // const docs = PrebuiltDocumentationMap.getByType('variable').find(v => v.name === child.text.slice(1));
          console.log(docs);
        }
        console.log({
          idx,
          text: child.text,
          type: child.type,
          id: child.id,
          prevCommand: NodeTypes.findPreviousSibling(child.parent!)!.text,
        });
      }
      idx++;
    }
  });

  describe('argparse variables', () => {
    it('find argparse tokens', () => {
      const testInfo = [
        {
          filename: 'functions/foo.fish',
          input: `function foo
    argparse --ignore-unknown "h/help" "v/value" new-flag= -- $argv
    or return

end`,
          expected: {
            name: 'argparse --ignore-unknown "h/help" "v/value" new-flag=',
            values: ['_flag_h', '_flag_help', '_flag_v', '_flag_value', '_flag_new_flag'],
          },
        },
      ];

      testInfo.forEach(({ filename, input, expected }) => {
        const doc = createFakeLspDocument(filename, input);
        const { rootNode } = parser.parse(doc.getText());
        for (const child of getChildNodes(rootNode)) {
          if (NodeTypes.isCommandWithName(child, 'argparse')) {
            const tokens = processArgparseCommand(doc, child);
            expect(tokens.map(t => t.name)).toEqual(expected.values);
          }
        }
      });
    });
  });

  it('is return number', () => {
    const { rootNode } = parser.parse('return 1; echo 125');
    const results: SyntaxNode[] = [];
    for (const child of getChildNodes(rootNode)) {
      if (NodeTypes.isReturn(child)) {
        // console.log(child.text);
        results.push(child);
      }
    }
    expect(results.length).toBe(1);
  });

  it('check command names', () => {
    const { rootNode } = parser.parse('set --show PWD; read -l dirs; echo $dirs');
    const empty: SyntaxNode[] = [];
    const results: SyntaxNode[] = [];
    for (const node of getChildNodes(rootNode)) {
      if (NodeTypes.isCommandWithName(node, 's', 'r')) {
        empty.push(node);
      }
      if (NodeTypes.isCommandWithName(node, 'set', 'read', 'echo')) {
        results.push(node);
      }
    }
    expect(empty.length).toBe(0);
    expect(results.length).toBe(3);
  });

  describe('autoloaded path variables', () => {
    //
    // beforeEach(async () => {
    //   // env.clear();
    //   await setupProcessEnvExecFile()
    //   env.set('fish_function_path', path.join(__dirname, 'workspaces', 'workspace_1', 'fish', 'functions'));
    //   // tests/workspaces/workspace_1/fish/completions/exa.fish
    //   env.set('fish_complete_path', path.join(__dirname, 'workspaces', 'workspace_1', 'fish', 'completions'));
    // })

    it('is autoloaded variable', () => {
      // for (const [k, v] of env.entries) {
      //   // console.log({
      //   //   key: k,
      //   //   value: v,
      //   //   isAutoloaded: AutoloadedPathVariables.includes(k),
      //   // })
      // }
      // console.log(env.get('fish_complete_path'));
      expect(env.get('fish_complete_path')).toBeDefined();
      expect(env.get('fish_function_path')).toBeDefined();
      // expect(env.get('__fish_data_dir')).toBeTruthy();
      // expect(env.get('__fish_config_dir')).toBeTruthy();
    });

    it('all autoloaded variables', () => {
      // console.log(env.isAutoloaded('fish_complete_path'));
      // AutoloadedPathVariables.all().forEach(path => {
      //   console.log(AutoloadedPathVariables.getHoverDocumentation(path));
      //   console.log('-'.repeat(80));
      // });
      expect(AutoloadedPathVariables.all().length).toBe(14);
    });

    it('AutoloadedPathVariables', () => {
      // const items = env.get('fish_complete_path');
      // expect(items).toBeDefined();
      env.append('fish_complete_path', path.join(__dirname, 'workspaces', 'workspace_1', 'fish', 'completions'));
      const { rootNode } = parser.parse('set -agx fish_complete_path $HOME/.config/fish/completions');
      // console.log(env.autoloadedFishVariables, env.findAutolaodedKey('fish_complete_path'));
      const results: SyntaxNode[] = [];
      for (const child of getChildNodes(rootNode)) {
        if (NodeTypes.isVariableDefinitionName(child) && env.isAutoloaded(child.text)) {
          // console.log({
          //   text: child.text,
          //   value: AutoloadedPathVariables.get(child.text),
          //   read: AutoloadedPathVariables.read(child.text),
          // });
          // console.log(AutoloadedPathVariables.getHoverDocumentation(child.text));
          // env.append(child.text, '$HOME/.config/fish/completions');
          results.push(child);
        }
      }
      expect(results.length).toBe(1);
      const documentation = AutoloadedPathVariables.getHoverDocumentation(results[0]!.text);
      const result = documentation.split('\n').shift();
      expect(result!.startsWith('(*variable*)')).toBeTruthy();
    });
  });

  describe('complete', () => {
    it('isCompleteCommandName(node) === true', () => {
      const { rootNode } = parser.parse('complete -c foo -a "bar"');
      const cmdName = getChildNodes(rootNode).find(child => child.text === 'foo');
      if (!cmdName) fail();

      expect(NodeTypes.isCompleteCommandName(cmdName)).toBeTruthy();
    });
    it('find isCompleteCommandName(node)', () => {
      const { rootNode } = parser.parse('complete -c foo -a "bar"');
      const results: SyntaxNode[] = [];
      for (const child of getChildNodes(rootNode)) {
        if (NodeTypes.isCompleteCommandName(child)) {
          results.push(child);
        }
      }
      expect(results.length).toBe(1);
    });

    it('find all isCompleteCommandName(node)', () => {
      const { rootNode } = parser.parse(`
complete -c foo -a "a"
complete -c foo -a "b"
complete -c foo -a "c"
complete -c foo -a "d"
complete -c foo -s h -l help -d 'help'
complete -c foo -s a -l args -d 'arguments'
complete -c foo -s c -l complete -d 'completions'
complete -c foo -s z -l null -d 'null'
complete -c foo -s d -l describe -d 'describe'`);
      const results: SyntaxNode[] = [];
      for (const child of getChildNodes(rootNode)) {
        if (NodeTypes.isCompleteCommandName(child)) {
          results.push(child);
        }
      }
      expect(results.length).toBe(9);
      expect(new Set([...results.map(n => n.text)]).size).toEqual(1);
    });
  });
});
