import Parser, { SyntaxNode } from 'web-tree-sitter';
import { CompletionTriggerKind, Position, SymbolKind } from 'vscode-languageserver';
import { initializeParser } from '../../parser';
import { LspDocument } from '../../document';
import { FishSymbol } from '../../parsing/symbol';
import { isVariableDefinitionName } from '../../parsing/barrel';
import * as SetParser from '../../parsing/set';
import * as ReadParser from '../../parsing/read';
import * as ArgparseParser from '../../parsing/argparse';
import * as FunctionParser from '../../parsing/function';
import { isCommandWithName, isOption, isVariableExpansion } from '../node-types';

/**
 * What kind of position the cursor is at. Decided once per request; the handler's
 * mode table (see `handler.ts`) maps each mode to the sources that fill it.
 *
 *  - `comment`   `# ...`, shebangs, `# @fish-lsp-*` directives
 *  - `variable`  a `$` expansion, or a `set` slot (`set `, `set -q `, `set -gx name `)
 *  - `empty`     a command position with nothing typed (`''`, `(`, `and `, `if `, `; `)
 *  - `command`   a command position with a partial word (`ec`, `(comman`)
 *  - `argument`  anything after a command (`ls -`, `string sp`, `function foo -e `)
 *  - `blocked`   after `end`/`else`/`continue`/`break`, where only pipes make sense
 */
export type CompletionMode = 'comment' | 'variable' | 'empty' | 'command' | 'argument' | 'blocked';

export interface CompletionContext {
  doc: LspDocument;
  position: Position;
  /** the full document line before the cursor */
  line: string;
  /**
   * The commandline being completed: `line`, or for an embedded commandline
   * (`complete -n '…`, `alias foo='…`) only the text inside the quotes.
   */
  commandline: string;
  /** `true` when `commandline` is text inside another command's quotes */
  embedded: boolean;
  mode: CompletionMode;
  /** current token before the cursor (`''` at a fresh slot) */
  word: string;
  /** command that owns the current token, if any */
  command: string | null;
  /** arguments of `command` before `word` */
  args: string[];
  /** argument slot of `word`, counting from 1 (0 at a command position) */
  argIndex: number;
  /** characters before the cursor replaced by an inserted item */
  replaceLength: number;
  /** `$`-prefix inserted before variable names (`variable` mode) */
  variablePrefix: string;
  /** cursor is a variable definition slot (`set NAME`, `read NAME`, `for NAME`) */
  isDefinitionSlot: boolean;
  /** symbols reachable at the cursor */
  symbols: FishSymbol[];
  variables: FishSymbol[];
  functions: FishSymbol[];
  triggerKind: CompletionTriggerKind;
  triggerCharacter?: string;
}

export type CompletionRequest = {
  doc: LspDocument;
  position: Position;
  symbols: FishSymbol[];
  /** word under the cursor from the document tree (`analyzer.parseCurrentLine`) */
  documentWord: string;
  /** node under the cursor from the document tree */
  current: SyntaxNode | null;
  triggerKind?: CompletionTriggerKind;
  triggerCharacter?: string;
};

const BLOCKED_COMMANDS = ['end', 'else', 'continue', 'break'];

/**
 * Parses single commandlines for completion. Owns its own tree-sitter parser so the
 * document's tree is never reset by a completion request.
 */
export class CompletionLineParser {
  static async create() {
    return new CompletionLineParser(await initializeParser());
  }

  constructor(private parser: Parser) { }

  private parse(text: string): SyntaxNode {
    this.parser.reset();
    return this.parser.parse(text).rootNode;
  }

  buildContext(request: CompletionRequest): CompletionContext {
    const { doc, position, symbols, documentWord, current } = request;
    const line = doc.getLineBeforeCursor(position).replace(/^(.*)\n$/, '$1') || '';
    const base = {
      doc,
      position,
      line,
      symbols,
      variables: symbols.filter(s => s.kind === SymbolKind.Variable),
      functions: symbols.filter(s => s.kind === SymbolKind.Function),
      triggerKind: request.triggerKind ?? CompletionTriggerKind.Invoked,
      triggerCharacter: request.triggerCharacter,
      variablePrefix: '',
      isDefinitionSlot: false,
    };

    if (line.trim().startsWith('#') && current) {
      return { ...base, commandline: line, embedded: false, mode: 'comment', word: documentWord, command: null, args: [], argIndex: 0, replaceLength: documentWord.length };
    }

    const embeddedText = getEmbeddedCommandline(line);
    const commandline = embeddedText ?? line;
    const { command, args, word } = tokenizeCommandline(commandline);

    // `set <TAB>`, `set -q <TAB>` and `set -gx name <TAB>` only take variables
    const isSetSlot = embeddedText === null && command === 'set' && word === '';
    if (isSetSlot || isInVariableExpansionContext(line, position, documentWord, current)) {
      const isDefinitionSlot = this.isVariableDefinitionSlot(line);
      const prefix = getVariableCompletionPrefix(line, position.character, documentWord, isDefinitionSlot);
      return {
        ...base,
        commandline: line,
        embedded: false,
        mode: 'variable',
        word: documentWord,
        command: null,
        args: [],
        argIndex: 0,
        replaceLength: prefix.replaceLength ?? (documentWord ? documentWord.length : 1),
        variablePrefix: prefix.insertPrefix,
        isDefinitionSlot,
      };
    }

    const mode: CompletionMode =
      command && BLOCKED_COMMANDS.includes(command) ? 'blocked'
        : !word && !command ? 'empty'
          : !command ? 'command'
            : 'argument';

    return {
      ...base,
      commandline,
      embedded: embeddedText !== null,
      mode,
      word,
      command,
      args,
      argIndex: command ? args.length + 1 : 0,
      replaceLength: word.length,
      isDefinitionSlot: mode === 'argument' && this.isVariableDefinitionSlot(commandline),
    };
  }

  /**
   * `true` when a variable inserted at the end of `lineBeforeCursor` should be a
   * plain name (a definition or bare-name slot) instead of a `$` expansion.
   */
  isVariableDefinitionSlot(lineBeforeCursor: string): boolean {
    try {
      const rootNode = this.parse(lineBeforeCursor);
      const currentNode = rootNode.descendantForPosition({
        row: 0,
        column: Math.max(0, lineBeforeCursor.length - 1),
      });
      if (!currentNode) return false;

      const endsWithSpace = /\s$/.test(lineBeforeCursor);

      // `set NAME [VALUE...]`: the first non-option argument is the variable being
      // defined; anything after it is a value. `set -q/-e/-S` only take names.
      // Probe at the last non-whitespace column: on a trailing-space cursor
      // `descendantForPosition` returns the program root, outside the command.
      const lastTokenColumn = Math.max(0, lineBeforeCursor.replace(/\s+$/, '').length - 1);
      let setCommand: SyntaxNode | null = rootNode.descendantForPosition({ row: 0, column: lastTokenColumn });
      while (setCommand && setCommand.type !== 'command') {
        setCommand = setCommand.parent;
      }
      if (setCommand && isCommandWithName(setCommand, 'set')) {
        if (!SetParser.isSetDefinition(setCommand)) {
          return true;
        }
        const nonOptionArgs = setCommand.childrenForFieldName('argument').filter(arg => !isOption(arg));
        const priorNonOptionArgs = endsWithSpace ? nonOptionArgs.length : Math.max(0, nonOptionArgs.length - 1);
        return priorNonOptionArgs === 0;
      }
      const { command: enclosingCommandName, args } = tokenizeCommandline(lineBeforeCursor);

      // Bare `set ` doesn't form a `command` node yet; the next slot is the name.
      if (!setCommand && enclosingCommandName === 'set') {
        return true;
      }

      // `for NAME in VALUES`: only the loop variable is a definition. A partial
      // `for ` line doesn't parse into a `for_statement`, so decide from the tokens.
      if (enclosingCommandName === 'for') {
        return args.length === 0;
      }

      // `function NAME --argument-names a b c`: operands after the flag are names
      // until another option begins.
      if (/^\s*function\s/.test(lineBeforeCursor)) {
        const afterArgNames = lineBeforeCursor.match(/\s(?:--argument-names|-a)\s+([\s\S]*)$/);
        if (afterArgNames && !/\s-/.test(afterArgNames[1]!)) {
          return true;
        }
      }

      // `read`/`argparse`/`function` names: at a fresh slot the node under the
      // cursor is the previous token, so parse a placeholder typed at the cursor
      // and reuse each command's definition-name detection on it.
      let probeNode = currentNode;
      if (endsWithSpace) {
        const probed = this.parse(lineBeforeCursor + 'fishLspProbe')
          .descendantForPosition({ row: 0, column: lineBeforeCursor.length });
        if (probed) probeNode = probed;
      }

      if (isVariableDefinitionName(probeNode)) {
        return true;
      }

      const grandParent = probeNode.parent?.parent;
      if (!grandParent) return false;
      const isProbe = (node: SyntaxNode) => node.equals(probeNode) || !!probeNode.parent && node.equals(probeNode.parent);

      if (isCommandWithName(grandParent, 'read')) {
        return ReadParser.findReadChildren(grandParent).definitionNodes.some(isProbe);
      }
      if (isCommandWithName(grandParent, 'argparse')) {
        return ArgparseParser.findArgparseDefinitionNames(grandParent).some(isProbe);
      }
      if (isCommandWithName(grandParent, 'function')) {
        return FunctionParser.findFunctionOptionNamedArguments(grandParent).variableNodes.some(isProbe);
      }
      return false;
    } catch {
      return false;
    }
  }
}

/**
 * Text typed so far inside an unterminated quoted commandline argument:
 *
 *    complete -c foo -n 'not __fish_seen    →  `not __fish_seen`
 *    complete -c foo -a "(                  →  `(`
 *    alias foo='git ch                      →  `git ch`
 *
 * Returns `null` when the cursor is not inside such a payload (`complete -x '` is
 * an argument list, not a commandline).
 */
export function getEmbeddedCommandline(line: string): string | null {
  // the first `-n`/`-a` payload wins: `complete -n 'test -n "$(cmd` completes `test -n "$(cmd`
  const complete = /(?:^|[\s;(|&])complete\s/.test(line)
    ? line.match(/(?:^|\s)(?:-n|--condition|-a|--arguments)\s+(['"])(.*)$/)
    : null;
  if (complete) {
    const [, quote, payload = ''] = complete;
    if (quote && !payload.includes(quote)) return payload.trimStart();
  }
  const alias = line.match(/^\s*alias\s+\S+\s*=\s*(['"])(.*)$/);
  if (alias) {
    const [, quote, payload = ''] = alias;
    if (quote && !payload.includes(quote)) return payload;
  }
  return null;
}

/** keywords after which the next token is a command: `and ec`, `if test`, `not `, `begin ` */
const COMMAND_PREFIX_KEYWORDS = ['and', 'or', 'not', '!', 'if', 'while', 'begin'];

/**
 * Splits the commandline before the cursor into the command that owns the cursor,
 * its finished arguments, and the word being typed. Quote and `(`/`$(` aware, so
 * it works on unfinished lines that don't parse (`function foo -e `, `break `):
 *
 *    commandline               command     args          word
 *    `ls -`                    `ls`        []            `-`
 *    `function foo -e `        `function`  [foo, -e]     ``
 *    `ec`                      null        []            `ec`   (a word at a command position)
 *    `echo (`                  null        []            ``     (`(` starts a new command)
 *    `if test -n foo; break `  `break`     []            ``     (`;` `|` `&&` start a new command)
 *    `else if `                null        []            ``     (command prefix keywords are skipped)
 *    `complete -x 'fo`         `complete`  [-x]          `fo`   (an unclosed quote isn't part of the word)
 */
export function tokenizeCommandline(commandline: string): { command: string | null; args: string[]; word: string; } {
  type Frame = { tokens: string[]; current: string; quote: '' | '\'' | '"'; quoteStart: number; };
  const newFrame = (): Frame => ({ tokens: [], current: '', quote: '', quoteStart: -1 });
  const endToken = (frame: Frame) => {
    if (frame.current) frame.tokens.push(frame.current);
    frame.current = '';
  };
  // one frame per open command substitution; the innermost one owns the cursor
  const stack: Frame[] = [newFrame()];

  for (let i = 0; i < commandline.length; i++) {
    let char = commandline[i]!;
    if (char === '\\' && i + 1 < commandline.length) char += commandline[++i];
    const frame = stack.at(-1)!;
    // enclosing commands see a whole substitution as part of their current token
    for (const outer of stack.slice(0, -1)) outer.current += char;

    if (frame.quote) {
      if (char === frame.quote) frame.quote = '';
      frame.current += char;
      if (char === '(' && frame.quote === '"' && frame.current.endsWith('$(')) stack.push(newFrame());
      continue;
    }
    if (char === '\'' || char === '"') {
      frame.quote = char;
      frame.quoteStart = frame.current.length;
      frame.current += char;
    } else if (char === '(') {
      frame.current += char;
      stack.push(newFrame());
    } else if (char === ')' && stack.length > 1) {
      stack.pop();
    } else if (/^\s$/.test(char)) {
      endToken(frame);
    } else if (char === ';' || char === '|' || char === '&' && !frame.current.endsWith('>') && commandline[i + 1] !== '>') {
      // `&` inside `2>&1` or `&>file` is a redirection, not a separator
      endToken(frame);
      frame.tokens = [];
    } else {
      frame.current += char;
    }
  }

  const frame = stack.at(-1)!;
  const word = frame.quote ? frame.current.slice(frame.quoteStart + 1) : frame.current;
  let start = 0;
  while (start < frame.tokens.length) {
    const token = frame.tokens[start]!;
    if (token === 'else' && frame.tokens[start + 1] === 'if') {
      start += 2;
    } else if (COMMAND_PREFIX_KEYWORDS.includes(token) || /^[A-Za-z_]\w*=/.test(token)) {
      // `FOO=bar cmd` is also a prefix
      start += 1;
    } else {
      break;
    }
  }
  const [command, ...args] = frame.tokens.slice(start);
  return { command: command ?? null, args, word };
}

/**
 * Determines if the cursor is within a variable expansion context:
 *   `echo $P`, `echo $$P`, `echo "$P`, `echo ${`, `echo $argv[$`
 */
export function isInVariableExpansionContext(lineBeforeCursor: string, position: Position, word: string, current: SyntaxNode | null): boolean {
  // `$(comman` is a command substitution, completed like `(comman`. Once
  // arguments begin, `$var` inside it must use normal variable completion.
  if (/\$\([^()\s]*$/.test(lineBeforeCursor)) {
    return false;
  }

  if (word.trim().endsWith('$') || lineBeforeCursor.trim().endsWith('$') || word.trim() === '$' && !word.startsWith('$$')) {
    return true;
  }

  if (current && (isVariableExpansion(current) || current.parent && isVariableExpansion(current.parent))) {
    return true;
  }

  return countDollarsBeforeWord(lineBeforeCursor, position.character).dollarsBeforeWord > 0;
}

function countDollarsBeforeWord(lineBeforeCursor: string, cursorPos: number) {
  let wordStartPos = cursorPos;
  while (wordStartPos > 0) {
    const char = lineBeforeCursor[wordStartPos - 1];
    if (char === ' ' || char === '\t' || char === '\n' || char === '$') {
      break;
    }
    wordStartPos--;
  }
  let dollarsBeforeWord = 0;
  for (let i = wordStartPos - 1; i >= 0 && lineBeforeCursor[i] === '$'; i--) {
    dollarsBeforeWord++;
  }
  return { wordStartPos, dollarsBeforeWord };
}

/**
 * The `$` prefix inserted before a variable name, and how much text it replaces:
 *
 *    `echo ${`      →  ''  (replace nothing, the brace is kept)
 *    `echo $`       →  '$' (replaces the typed `$`)
 *    `set -gx `     →  ''  (definition slot)
 *    `set -gx v `   →  '$' (value slot)
 */
export function getVariableCompletionPrefix(
  lineBeforeCursor: string,
  cursorPos: number,
  word: string,
  isDefinitionSlot: boolean,
): { insertPrefix: string; replaceLength?: number; } {
  const { wordStartPos, dollarsBeforeWord } = countDollarsBeforeWord(lineBeforeCursor, cursorPos);
  const dollarsInWord = (word.match(/\$/g) || []).length;
  const prefixSlice = lineBeforeCursor.slice(Math.max(wordStartPos - dollarsBeforeWord, 0), cursorPos);

  if (prefixSlice.endsWith('${')) {
    return { insertPrefix: '', replaceLength: 0 };
  }
  if (prefixSlice.endsWith('$')) {
    return { insertPrefix: '$' };
  }

  const shouldAddDollarPrefix =
    dollarsBeforeWord === 0 && dollarsInWord === 0 && !isDefinitionSlot
    || dollarsInWord > 0;
  const dollarPrefix = dollarsInWord > 0 ? '$'.repeat(dollarsInWord) : shouldAddDollarPrefix ? '$' : '';
  return { insertPrefix: dollarPrefix };
}
