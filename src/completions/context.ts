import Parser, { SyntaxNode, Tree } from 'web-tree-sitter';
import { CompletionTriggerKind, Position, SymbolKind } from 'vscode-languageserver';
import { initializeParser } from '../parser';
import { LspDocument } from '../document';
import { FishSymbol } from '../parsing/symbol';
import { isVariableDefinitionName } from '../parsing/barrel';
import * as SetParser from '../parsing/set';
import * as ReadParser from '../parsing/read';
import * as ArgparseParser from '../parsing/argparse';
import * as FunctionParser from '../parsing/function';
import { isCommandWithName, isOption, isVariableExpansion } from '../utils/node-types';

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
  /** Text from each command position in the current segment to the cursor. */
  snippetPrefixes: string[];
  /** The cursor follows a complete command or block, rather than an unfinished operand. */
  canEndCommand: boolean;
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

/** tree-sitter nodes closed by `end` or `}`; their endings take pipes and redirects like a command */
const BLOCK_NODES = ['begin_statement', 'if_statement', 'while_statement', 'for_statement', 'switch_statement', 'function_definition'];

/**
 * Parses single commandlines for completion. Owns its own tree-sitter parser so the
 * document's tree is never reset by a completion request.
 */
export class CompletionLineParser {
  static async create() {
    return new CompletionLineParser(await initializeParser());
  }

  constructor(private parser: Parser) { }

  /** the caller owns the returned tree and must `delete()` it */
  private parse(text: string): Tree {
    this.parser.reset();
    return this.parser.parse(text);
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
      canEndCommand: false,
    };

    if (line.trim().startsWith('#') && current) {
      return { ...base, snippetPrefixes: [], commandline: line, embedded: false, mode: 'comment', word: documentWord, command: null, args: [], argIndex: 0, replaceLength: documentWord.length };
    }

    const embeddedText = getEmbeddedCommandline(line);
    // Everything before the cursor, so a quote, a `(` or a `\` continuation opened
    // on an earlier line is still open here. `tokenizeCommandline` cuts it back to
    // the statement that owns the cursor.
    const prefix = embeddedText ?? doc.getText({ start: { line: 0, character: 0 }, end: position });
    const { command, args, word, snippetPrefixes, start } = tokenizeCommandline(prefix);
    const commandline = prefix.slice(start);
    const ending = this.commandEnding(prefix, word);
    base.canEndCommand = ending !== null;
    // an unterminated string reaches back over earlier lines; only replace this line's part
    const wordOnLine = word.slice(word.lastIndexOf('\n') + 1);

    // `set <TAB>`, `set -q <TAB>` and `set -gx name <TAB>` only take variables
    const isSetSlot = embeddedText === null && command === 'set' && word === '';
    if (isSetSlot || isInVariableExpansionContext(line, position, documentWord, current)) {
      const isDefinitionSlot = this.isVariableDefinitionSlot(line);
      const prefix = getVariableCompletionPrefix(line, position.character, documentWord, isDefinitionSlot);
      return {
        ...base,
        snippetPrefixes,
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
      ending === 'block' || command && BLOCKED_COMMANDS.includes(command) ? 'blocked'
        : !word && !command ? 'empty'
          : !command ? 'command'
            : 'argument';

    return {
      ...base,
      snippetPrefixes,
      commandline,
      embedded: embeddedText !== null,
      mode,
      word: ending === 'block' ? '' : word,
      command,
      args,
      argIndex: command ? args.length + 1 : 0,
      replaceLength: ending === 'block' ? 0 : wordOnLine.length,
      isDefinitionSlot: mode === 'argument' && this.isVariableDefinitionSlot(commandline),
    };
  }

  /**
   * Whether the cursor follows a finished command or block, so pipes and
   * redirects can extend it. `text` is everything before the cursor (the
   * document, or an embedded commandline), so continuation lines and an
   * `end`/`}` closing an earlier line parse in context. A newline is
   * appended because tree-sitter only closes a bare `foo ` at a line end. The
   * innermost error-free node ending at the last non-blank character of the
   * cursor's line decides:
   * `foo | ` and `foo > ` leave an ERROR there, `foo; ` an anonymous `;`.
   */
  private commandEnding(text: string, word: string): 'command' | 'block' | null {
    // `}` is the only word that can't be extended; `end` could still be a name
    if (word && word !== '}') return null;
    // a newline before the cursor already ended the statement
    const end = text.replace(/[ \t]+$/, '').length;
    if (!end || text[end - 1] === '\n') return null;
    const tree = this.parse(text + '\n');
    try {
      let node: SyntaxNode | null = tree.rootNode.descendantForIndex(end - 1);
      if (node.type === 'comment') return null;
      while (node && node.endIndex === end) {
        if (!node.hasError) {
          if (BLOCK_NODES.includes(node.type)) return 'block';
          if (node.type === 'command') return 'command';
        }
        node = node.parent;
      }
      return null;
    } finally {
      tree.delete();
    }
  }

  /**
   * `true` when a variable inserted at the end of `lineBeforeCursor` should be a
   * plain name (a definition or bare-name slot) instead of a `$` expansion.
   * Indexed rather than row/column, so a commandline spanning lines still works.
   */
  isVariableDefinitionSlot(lineBeforeCursor: string): boolean {
    const trees: Tree[] = [];
    try {
      const tree = this.parse(lineBeforeCursor);
      trees.push(tree);
      const rootNode = tree.rootNode;
      const currentNode = rootNode.descendantForIndex(Math.max(0, lineBeforeCursor.length - 1));
      if (!currentNode) return false;

      const endsWithSpace = /\s$/.test(lineBeforeCursor);

      // `set NAME [VALUE...]`: the first non-option argument is the variable being
      // defined; anything after it is a value. `set -q/-e/-S` only take names.
      // Probe at the last non-whitespace column: on a trailing-space cursor
      // `descendantForIndex` returns the program root, outside the command.
      const lastTokenIndex = Math.max(0, lineBeforeCursor.replace(/\s+$/, '').length - 1);
      let setCommand: SyntaxNode | null = rootNode.descendantForIndex(lastTokenIndex);
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
        const probeTree = this.parse(lineBeforeCursor + 'fishLspProbe');
        trees.push(probeTree);
        const probed = probeTree.rootNode.descendantForIndex(lineBeforeCursor.length);
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
    } finally {
      trees.forEach(tree => tree.delete());
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
  // The quote left open is the payload being typed; quotes closed before it
  // (`-n '…' -d '…' -xa '(`) and quotes inside it (`-n 'test -n "$(cmd`) don't count.
  // `-a`/`-n` may end a cluster of flags that take no value (`-xa`, `-fka`).
  const open = /(?:^|[\s;(|&])complete\s/.test(line) ? openQuoteIndex(line) : -1;
  if (open !== -1 && /(?:^|\s)(?:-[fFrxkeh]*[an]|--condition|--arguments)\s+$/.test(line.slice(0, open))) {
    return line.slice(open + 1).trimStart();
  }
  const alias = line.match(/^\s*alias\s+\S+\s*=\s*(['"])(.*)$/);
  if (alias) {
    const [, quote, payload = ''] = alias;
    if (quote && !payload.includes(quote)) return payload;
  }
  return null;
}

/** index of the quote `line` leaves open, skipping escapes and closed strings, or -1 */
function openQuoteIndex(line: string): number {
  let open = -1;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '\\') {
      i++;
    } else if (open === -1 && (char === '\'' || char === '"')) {
      open = i;
    } else if (open !== -1 && char === line[open]) {
      open = -1;
    }
  }
  return open;
}

/** keywords after which the next token is a command: `and ec`, `if test`, `not `, `begin ` */
const COMMAND_PREFIX_KEYWORDS = ['and', 'or', 'not', '!', 'if', 'while', 'begin'];

/**
 * Splits the commandline before the cursor into the command that owns the cursor,
 * its finished arguments, and the word being typed. Quote and `(`/`$(` aware, so
 * it works on unfinished lines that don't parse (`function foo -e `, `break `):
 *
 * Accepts the whole text before the cursor, so a quote or `(` opened on an earlier
 * line is still open: an unescaped newline ends a statement exactly like `;`, and
 * `start` reports where the statement owning the cursor begins.
 *
 *    commandline               command     args          word
 *    `ls -`                    `ls`        []            `-`
 *    `function foo -e `        `function`  [foo, -e]     ``
 *    `ec`                      null        []            `ec`   (a word at a command position)
 *    `echo (`                  null        []            ``     (`(` starts a new command)
 *    `if test -n foo; break `  `break`     []            ``     (`;` `|` `&&` start a new command)
 *    `else if `                null        []            ``     (command prefix keywords are skipped)
 *    `complete -x 'fo`         `complete`  [-x]          `fo`   (an unclosed quote isn't part of the word)
 *    `echo "a\nb" `            `echo`      ["a\nb"]      ``     (the newline is inside the string)
 */
export function tokenizeCommandline(commandline: string): { command: string | null; args: string[]; word: string; snippetPrefixes: string[]; start: number; } {
  type Frame = { tokens: string[]; tokenStarts: number[]; current: string; currentStart: number; wordStart: number; quote: '' | '\'' | '"'; quoteStart: number; start: number; };
  const newFrame = (): Frame => ({ tokens: [], tokenStarts: [], current: '', currentStart: 0, wordStart: 0, quote: '', quoteStart: -1, start: 0 });
  const endToken = (frame: Frame) => {
    if (frame.current) {
      frame.tokens.push(frame.current);
      frame.tokenStarts.push(frame.currentStart);
    }
    frame.current = '';
    frame.wordStart = 0;
  };
  // one frame per open command substitution; the innermost one owns the cursor
  const stack: Frame[] = [newFrame()];

  for (let i = 0; i < commandline.length; i++) {
    const charStart = i;
    let char = commandline[i]!;
    if (char === '\\' && i + 1 < commandline.length) char += commandline[++i];
    // `\` before a newline is a continuation: fish joins the lines with nothing between
    if (char === '\\\n') continue;
    const frame = stack.at(-1)!;
    if (!frame.current) frame.currentStart = charStart;
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
    } else if (char === '\n' || char === ';' || char === '|' || char === '&' && !frame.current.endsWith('>') && commandline[i + 1] !== '>') {
      // an unescaped newline ends a statement like `;`; `&` inside `2>&1` or
      // `&>file` is a redirection, not a separator
      endToken(frame);
      frame.tokens = [];
      frame.tokenStarts = [];
      frame.start = i + 1;
    } else if (/^\s$/.test(char)) {
      endToken(frame);
    } else {
      frame.current += char;
      // Keep the redirect in the token for context, but only replace its target.
      // Quoted and escaped operators never reach this branch as a single character.
      if (char === '>' || char === '<' || char === '?' && frame.current.endsWith('>?')) {
        frame.wordStart = frame.current.length;
      }
    }
  }

  const frame = stack.at(-1)!;
  const word = frame.current.slice(frame.quote ? frame.quoteStart + 1 : frame.wordStart);
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
  // Include prefix keywords as possible snippet starts (`if else`), but never
  // start at an ordinary argument (`echo set color`) or inside a quoted string.
  // a prefix reaching back over a newline can't match a trigger, and the snippet
  // source rewrites a single line, so keep them within the cursor's line
  const snippetPrefixes = frame.quote ? [] : frame.tokenStarts.slice(0, start + 1)
    .map(offset => commandline.slice(offset))
    .filter(text => !text.includes('\n'));
  return { command: command ?? null, args, word, snippetPrefixes, start: stack[0]!.start };
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
 * The term being typed inside the last unclosed `[` of `text` (`$var[1..va` → `va`),
 * with the `$`s typed before it and the text before that `[`, or `null` outside one.
 * A nested, closed `[…]` is skipped.
 */
export function openIndexTerm(text: string): { before: string; dollars: string; name: string; } | null {
  let depth = 0;
  for (let index = text.length - 1; index >= 0; index--) {
    const char = text[index];
    if (char === '\n') return null;
    if (char === ']') {
      depth++;
    } else if (char === '[' && depth > 0) {
      depth--;
    } else if (char === '[') {
      const [, dollars = '', name = ''] = /(\$*)(\w*)$/.exec(text.slice(index + 1)) ?? [];
      return { before: text.slice(0, index), dollars, name };
    }
  }
  return null;
}

/**
 * The `$` prefix inserted before a variable name, and how much text it replaces:
 *
 *    `echo ${`      →  ''  (replace nothing, the brace is kept)
 *    `echo $`       →  '$' (replaces the typed `$`)
 *    `set -gx `     →  ''  (definition slot)
 *    `set -gx v `   →  '$' (value slot)
 *    `echo $v[i`    →  '$' (an index term without a `$`: replaces `i`, keeps `$v[`)
 */
export function getVariableCompletionPrefix(
  lineBeforeCursor: string,
  cursorPos: number,
  word: string,
  isDefinitionSlot: boolean,
): { insertPrefix: string; replaceLength?: number; } {
  // inside `$var[…]` a variable is read with `$`; a term already holding one
  // (`$var[$`, `$var[$v`) is handled like any other `$` below
  const indexTerm = openIndexTerm(lineBeforeCursor.slice(0, cursorPos));
  if (indexTerm && !indexTerm.dollars && /\$\w+$/.test(indexTerm.before)) {
    return { insertPrefix: '$', replaceLength: indexTerm.name.length };
  }

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
