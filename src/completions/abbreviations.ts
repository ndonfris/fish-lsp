import { readFileSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { basename, dirname, join } from 'path';
import Parser, { SyntaxNode } from 'web-tree-sitter';
import { InsertTextFormat } from 'vscode-languageserver';
import { md } from '../utils/markdown-builder';
import { FishString } from '../parsing/string';
import {
  cloneCompletionItem,
  FishCompletionItem,
  FishCompletionItemKind,
} from './types';

/**
 * A fish abbreviation stored the way `abbr --add` records it.
 *
 * `--function` and `--regex` are not represented: their expansion is not a fixed
 * string, so those definitions remove any previous literal with the same name
 * and command list instead of becoming a completion.
 */
export type FishAbbreviation = {
  name: string;
  expansion: string;
  /** fish defaults to `command`, and to `anywhere` when `--command` is set */
  position: 'command' | 'anywhere';
  /** empty means the abbreviation is not limited to a command */
  commands: string[];
  /** present when `--set-cursor` was set; fish erases the first match */
  cursorMarker?: string;
  /** the `abbr` command, shown as documentation */
  source: string;
};

export type AbbreviationReader = (filePath: string) => string | undefined;

type Token = {
  text: string;
  dynamic: boolean;
};

type Effect =
  | { kind: 'ignore'; }
  | { kind: 'add'; abbr: FishAbbreviation; }
  | { kind: 'shadow'; name: string; commands: string[]; }
  | { kind: 'erase'; names: string[]; commands: string[]; }
  | { kind: 'rename'; from: string; to: string; commands: string[]; };

const DYNAMIC_NODE_TYPES = ['command_substitution', 'variable_expansion', 'glob'];

/**
 * Snippet text is escaped `\` first, then `$`, then `}`. Escaping `$` first would
 * turn the inserted backslash into a second escape.
 */
export function escapeSnippetText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\$/g, '\\$').replace(/}/g, '\\}');
}

function snippetSensitive(text: string): boolean {
  return text.includes('\\') || text.includes('$') || text.includes('}');
}

/**
 * The text a completion inserts. The cursor marker is replaced after escaping so
 * the generated `$0` is not itself escaped.
 */
export function abbreviationInsertText(
  expansion: string,
  cursorMarker?: string,
): { insertText: string; insertTextFormat?: InsertTextFormat; } {
  const plain = (text: string) => snippetSensitive(text)
    ? { insertText: escapeSnippetText(text), insertTextFormat: InsertTextFormat.Snippet }
    : { insertText: text };

  if (cursorMarker === undefined) return plain(expansion);
  const at = expansion.indexOf(cursorMarker);
  if (at < 0) return plain(expansion);
  const before = escapeSnippetText(expansion.slice(0, at));
  const after = escapeSnippetText(expansion.slice(at + cursorMarker.length));
  return { insertText: `${before}$0${after}`, insertTextFormat: InsertTextFormat.Snippet };
}

export function abbreviationSortText(name: string, commands: readonly string[]): string {
  return commands.length === 0 ? `0_abbr_${name}` : `0_abbr_${name}_${commands.join(',')}`;
}

function detailFor(abbr: FishAbbreviation): string {
  if (abbr.commands.length === 0) return 'abbreviation';
  return `(${abbr.commands.join(', ')}) → ${abbr.expansion}`;
}

function documentationFor(abbr: FishAbbreviation): string {
  return [
    `(${md.bold('abbr')}) ${md.inlineCode(abbr.name)}`,
    md.separator(),
    md.codeBlock('fish', abbr.source),
  ].join('\n');
}

export function abbreviationToCompletionItem(abbr: FishAbbreviation): FishCompletionItem {
  const detail = detailFor(abbr);
  const documentation = documentationFor(abbr);
  // `FishAbbrCompletionItem` derives insertText from documentation; replace it.
  const item = FishCompletionItem.create(abbr.name, FishCompletionItemKind.ABBR, detail, documentation);
  const insertion = abbreviationInsertText(abbr.expansion, abbr.cursorMarker);
  item.insertText = insertion.insertText;
  if (insertion.insertTextFormat !== undefined) item.insertTextFormat = insertion.insertTextFormat;
  item.sortText = abbreviationSortText(abbr.name, abbr.commands);
  item.setPriority(0);
  item.data = {
    uri: '',
    line: abbr.source,
    word: abbr.name,
    position: { line: 0, character: 0 },
    fishKind: item.fishKind,
    detail,
    documentation,
    abbreviation: {
      position: abbr.position,
      commands: [...abbr.commands],
    },
  };
  return item;
}

/**
 * Abbreviations that fish would expand at this cursor. When several share a name
 * and all match, the later definition wins, which is the one fish expands.
 */
export function abbreviationCompletions(
  items: FishCompletionItem[],
  mode: string,
  command: string | null,
): FishCompletionItem[] {
  if (mode !== 'empty' && mode !== 'command' && mode !== 'argument') return [];
  const atCommand = mode === 'empty' || mode === 'command';
  const current = command ?? '';
  const chosen = new Map<string, FishCompletionItem>();
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (!item) continue;
    const meta = item.data?.abbreviation;
    if (!meta) continue;
    if (meta.position === 'command' && !atCommand) continue;
    if (meta.commands.length > 0 && !meta.commands.includes(current)) continue;
    if (!chosen.has(item.label)) chosen.set(item.label, item);
  }
  return [...chosen.values()].reverse().map(item => cloneCompletionItem(item).setPriority(0));
}

function sameCommands(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((command, index) => command === right[index]);
}

class AbbreviationSet {
  private items: FishAbbreviation[] = [];

  list(): FishAbbreviation[] {
    return this.items.map(item => ({ ...item, commands: [...item.commands] }));
  }

  apply(effect: Effect): void {
    switch (effect.kind) {
      case 'ignore':
        return;
      case 'add':
        this.items = this.items.filter(item => !sameIdentity(item, effect.abbr.name, effect.abbr.commands));
        this.items.push(effect.abbr);
        return;
      case 'shadow':
        this.items = this.items.filter(item => !sameIdentity(item, effect.name, effect.commands));
        return;
      case 'erase':
        for (const name of effect.names) {
          this.items = this.items.filter(item => !sameIdentity(item, name, effect.commands));
        }
        return;
      case 'rename': {
        const index = this.items.findIndex(item => sameIdentity(item, effect.from, effect.commands));
        if (index < 0) return;
        if (this.items.some(item => sameIdentity(item, effect.to, effect.commands))) return;
        const current = this.items[index];
        if (!current) return;
        this.items[index] = { ...current, name: effect.to };
        return;
      }
    }
  }
}

function sameIdentity(item: FishAbbreviation, name: string, commands: readonly string[]): boolean {
  return item.name === name && sameCommands(item.commands, commands);
}

export function abbreviationsFromSource(source: string, parser: Parser): FishAbbreviation[] {
  const tree = parser.parse(source);
  try {
    const set = new AbbreviationSet();
    applyTree(tree.rootNode, set);
    return set.list();
  } finally {
    tree.delete();
  }
}

/**
 * Command substitutions run before the `abbr` they belong to, so nested `abbr`
 * commands are applied on the way down.
 *
 * Function bodies are skipped. A `function` is not run while Fish sources
 * `config.fish` unless something calls it, and that call is not visible
 * statically. Top-level commands and blocks such as `if status is-interactive`
 * still run, so abbreviations there are kept.
 *
 * Both sides of `if`/`else` and `switch` are applied in source order. The
 * condition can be any command, so choosing a branch without executing the
 * file would be wrong for every condition we do not hard-code.
 */
function applyTree(root: SyntaxNode, set: AbbreviationSet): void {
  const visit = (node: SyntaxNode): void => {
    if (node.type === 'function_definition') return;
    if (isAbbrCommand(node)) {
      for (const arg of node.childrenForFieldName('argument')) visit(arg);
      set.apply(effectFromCommand(node));
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
}

function isAbbrCommand(node: SyntaxNode): boolean {
  return node.type === 'command' && node.childForFieldName('name')?.text === 'abbr';
}

function effectFromCommand(command: SyntaxNode): Effect {
  const tokens: Token[] = [];
  for (const arg of command.childrenForFieldName('argument')) {
    if (isDynamicArgument(arg)) {
      tokens.push({ text: '', dynamic: true });
      continue;
    }
    for (const text of expandArgument(arg)) tokens.push({ text, dynamic: false });
  }
  return parseInvocation(tokens, command.text);
}

function isDynamicArgument(node: SyntaxNode): boolean {
  if (node.type === 'single_quote_string') return false;
  if (node.descendantsOfType(DYNAMIC_NODE_TYPES).some(child => !insideSingleQuotes(child))) return true;
  const homes = node.type === 'home_dir_expansion' ? [node] : node.descendantsOfType('home_dir_expansion');
  return homes.some(child => !insideSingleQuotes(child) && /^~[^/]/.test(child.text));
}

function insideSingleQuotes(node: SyntaxNode): boolean {
  let parent = node.parent;
  while (parent) {
    if (parent.type === 'single_quote_string') return true;
    parent = parent.parent;
  }
  return false;
}

function expandArgument(node: SyntaxNode): string[] {
  switch (node.type) {
    case 'single_quote_string':
      return [unescapeSingle(node.text.slice(1, -1))];
    case 'double_quote_string':
      return [unescapeDouble(node.text.slice(1, -1))];
    case 'escape_sequence':
      return [unescapeUnquoted(node.text)];
    case 'home_dir_expansion':
      return [expandHome(node.text)];
    case 'concatenation':
      // `=` between `--set-cursor` and `%` is its own token and is not a named child.
      return combine(node.children.filter(child => child.text.length > 0));
    case 'brace_expansion':
      return expandBraceText(node.text).map(unescapeUnquoted);
    default:
      return expandBraceText(node.text).map(unescapeUnquoted);
  }
}

function combine(nodes: SyntaxNode[]): string[] {
  let acc = [''];
  for (const node of nodes) {
    const next = expandArgument(node);
    acc = acc.flatMap(prefix => next.map(value => prefix + value));
  }
  return acc;
}

function unescapeSingle(inner: string): string {
  return inner.replace(/\\([\\'])/g, '$1');
}

/** In double quotes fish only treats `\"`, `\$`, `\\`, and a backslash before a newline as escapes. */
function unescapeDouble(inner: string): string {
  let out = '';
  for (let index = 0; index < inner.length; index++) {
    const char = inner[index]!;
    if (char !== '\\' || index + 1 >= inner.length) {
      out += char;
      continue;
    }
    const next = inner[index + 1]!;
    if (next === '\n') {
      index += 1;
      continue;
    }
    if (next === '\r' && inner[index + 2] === '\n') {
      index += 2;
      continue;
    }
    if (next === '"' || next === '$' || next === '\\') {
      out += next;
      index += 1;
      continue;
    }
    out += char;
  }
  return out;
}

function unescapeUnquoted(text: string): string {
  return text.includes('\\') ? FishString.fromText(text) : text;
}

function expandHome(text: string): string {
  if (text === '~') return homedir();
  if (text.startsWith('~/')) return join(homedir(), text.slice(2));
  return text;
}

function isEscaped(input: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && input[cursor] === '\\'; cursor--) slashes += 1;
  return slashes % 2 === 1;
}

function matchingBrace(input: string, open: number): number {
  let depth = 0;
  for (let index = open; index < input.length; index++) {
    if (isEscaped(input, index)) continue;
    const char = input[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function hasTopLevelComma(body: string): boolean {
  let depth = 0;
  for (let index = 0; index < body.length; index++) {
    if (isEscaped(body, index)) continue;
    const char = body[index];
    if (char === '{') depth += 1;
    else if (char === '}') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) return true;
  }
  return false;
}

function splitTopLevelCommas(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index++) {
    if (isEscaped(body, index)) continue;
    const char = body[index];
    if (char === '{') depth += 1;
    else if (char === '}') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) {
      parts.push(body.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

/**
 * Fish expands `{git,hg}` before `abbr` sees the arguments. Braces expand only
 * when a comma sits at the top of that pair, so `{{a,b}}` becomes `{a}` `{b}`.
 */
function expandBraceText(input: string, depth = 0): string[] {
  if (depth > 20) return [input];
  let found: { start: number; end: number; body: string; } | undefined;
  for (let index = 0; index < input.length; index++) {
    if (isEscaped(input, index) || input[index] !== '{') continue;
    const end = matchingBrace(input, index);
    if (end < 0) continue;
    const body = input.slice(index + 1, end);
    if (!hasTopLevelComma(body)) continue;
    found = { start: index, end, body };
    break;
  }
  if (!found) return [input];
  const prefix = input.slice(0, found.start);
  const suffix = input.slice(found.end + 1);
  return splitTopLevelCommas(found.body).flatMap(alt => expandBraceText(prefix + alt + suffix, depth + 1));
}

type ParseState = {
  add: boolean;
  rename: boolean;
  show: boolean;
  list: boolean;
  erase: boolean;
  query: boolean;
  help: boolean;
  invalid: boolean;
  dynamicCommands: boolean;
  functionName?: string;
  regex?: string;
  commands: string[];
  position?: 'command' | 'anywhere';
  cursorSeen: boolean;
  cursorMarker: string;
};

function parseInvocation(tokens: Token[], source: string): Effect {
  const state: ParseState = {
    add: false,
    rename: false,
    show: false,
    list: false,
    erase: false,
    query: false,
    help: false,
    invalid: false,
    dynamicCommands: false,
    commands: [],
    cursorSeen: false,
    cursorMarker: '%',
  };
  let index = 0;
  let endOptions = false;
  const positionals: Array<string | 'dynamic'> = [];

  const takeValue = (): string | 'dynamic' | undefined => {
    const next = tokens[index];
    if (!next) return undefined;
    index += 1;
    return next.dynamic ? 'dynamic' : next.text;
  };

  const pushPositional = (value: string | 'dynamic'): void => {
    positionals.push(value);
    // Once the name and the first expansion word are known, later flags belong
    // to the expansion (`abbr e emacs -nw`). Erase/rename/show keep parsing.
    const stopEarly = positionals.length >= 2
      && !state.rename && !state.show && !state.list && !state.erase && !state.query;
    if (!stopEarly) return;
    while (index < tokens.length) {
      const token = tokens[index];
      index += 1;
      if (!token) break;
      positionals.push(token.dynamic ? 'dynamic' : token.text);
    }
  };

  while (index < tokens.length) {
    const token = tokens[index];
    if (!token) break;
    index += 1;
    if (token.dynamic) {
      pushPositional('dynamic');
      continue;
    }
    const text = token.text;
    if (!endOptions && text === '--') {
      endOptions = true;
      continue;
    }
    if (!endOptions && text.startsWith('--') && text.length > 2) {
      if (!consumeLong(state, text, takeValue)) return { kind: 'ignore' };
      continue;
    }
    if (!endOptions && text.startsWith('-') && text.length > 1) {
      if (!consumeShort(state, text.slice(1), takeValue)) return { kind: 'ignore' };
      continue;
    }
    pushPositional(text);
  }
  return finishInvocation(state, positionals, source);
}

function consumeLong(
  state: ParseState,
  text: string,
  takeValue: () => string | 'dynamic' | undefined,
): boolean {
  const eq = text.indexOf('=');
  const name = eq === -1 ? text : text.slice(0, eq);
  const inline = eq === -1 ? undefined : text.slice(eq + 1);
  const required = (): string | 'dynamic' | undefined => inline !== undefined ? inline : takeValue();

  switch (name) {
    case '--add':
      if (inline !== undefined) return fail(state);
      state.add = true;
      return true;
    case '--command': {
      const value = required();
      if (value === undefined) return fail(state);
      if (value === 'dynamic') state.dynamicCommands = true;
      else state.commands.push(value);
      return true;
    }
    case '--position': {
      if (state.position) return fail(state);
      const value = required();
      if (value !== 'command' && value !== 'anywhere') return fail(state);
      state.position = value;
      return true;
    }
    case '--regex': {
      if (state.regex !== undefined) return fail(state);
      const value = required();
      if (value === undefined || value === 'dynamic') return fail(state);
      state.regex = value;
      return true;
    }
    case '--function': {
      const value = required();
      if (value === undefined || value === 'dynamic') return fail(state);
      state.functionName = value;
      return true;
    }
    case '--set-cursor': {
      if (state.cursorSeen) return fail(state);
      // Optional arguments are only attached with `=`. A following word is a positional.
      state.cursorSeen = true;
      state.cursorMarker = inline !== undefined ? inline : '%';
      if (state.cursorMarker === '') return fail(state);
      return true;
    }
    case '--description':
      return true;
    case '--rename':
      if (inline !== undefined) return fail(state);
      state.rename = true;
      return true;
    case '--erase':
      if (inline !== undefined) return fail(state);
      state.erase = true;
      return true;
    case '--query':
      if (inline !== undefined) return fail(state);
      state.query = true;
      return true;
    case '--show':
      if (inline !== undefined) return fail(state);
      state.show = true;
      return true;
    case '--list':
      if (inline !== undefined) return fail(state);
      state.list = true;
      return true;
    case '--global':
    case '--universal':
    case '--help':
      if (name === '--help') state.help = true;
      return inline === undefined;
    default:
      return fail(state);
  }
}

function consumeShort(
  state: ParseState,
  cluster: string,
  takeValue: () => string | 'dynamic' | undefined,
): boolean {
  for (let index = 0; index < cluster.length; index++) {
    const flag = cluster[index];
    if (flag === 'c' || flag === 'f' || flag === 'r') {
      const inline = cluster.slice(index + 1);
      const value = inline ? inline : takeValue();
      if (value === undefined) return fail(state);
      if (flag === 'c') {
        if (value === 'dynamic') state.dynamicCommands = true;
        else state.commands.push(value);
      } else if (flag === 'f') {
        if (value === 'dynamic') return fail(state);
        state.functionName = value;
      } else if (state.regex !== undefined || value === 'dynamic') {
        return fail(state);
      } else {
        state.regex = value;
      }
      return true;
    }
    switch (flag) {
      case 'a':
        state.add = true;
        break;
      case 's':
        state.show = true;
        break;
      case 'e':
        state.erase = true;
        break;
      case 'q':
        state.query = true;
        break;
      case 'g':
      case 'U':
        break;
      case 'h':
        state.help = true;
        break;
      default:
        return fail(state);
    }
  }
  return true;
}

function fail(state: ParseState): false {
  state.invalid = true;
  return false;
}

function finishInvocation(state: ParseState, positionals: Array<string | 'dynamic'>, source: string): Effect {
  if (state.invalid || state.help) return { kind: 'ignore' };
  const selected = [state.add, state.rename, state.show, state.list, state.erase, state.query].filter(Boolean);
  if (selected.length > 1) return { kind: 'ignore' };
  if (selected.length === 0) {
    if (positionals.length === 0) return { kind: 'ignore' };
    state.add = true;
  }
  if (state.show || state.list || state.query) return { kind: 'ignore' };
  if (state.dynamicCommands) return { kind: 'ignore' };

  if (state.rename) {
    if (positionals.length !== 2 || positionals.some(part => part === 'dynamic')) return { kind: 'ignore' };
    const from = positionals[0];
    const to = positionals[1];
    if (!from || !to || from === 'dynamic' || to === 'dynamic' || /\s/.test(to)) return { kind: 'ignore' };
    return { kind: 'rename', from, to, commands: state.commands };
  }
  if (state.erase) {
    if (positionals.length === 0 || positionals.some(part => part === 'dynamic')) return { kind: 'ignore' };
    return { kind: 'erase', names: positionals.filter((part): part is string => part !== 'dynamic'), commands: state.commands };
  }

  const name = positionals[0];
  if (!name || name === 'dynamic' || /\s/.test(name)) return { kind: 'ignore' };
  if (state.functionName !== undefined && positionals.length > 1) return { kind: 'ignore' };
  if (state.regex !== undefined || state.functionName !== undefined) {
    return { kind: 'shadow', name, commands: [...state.commands] };
  }
  const expansionParts = positionals.slice(1);
  if (expansionParts.length === 0) return { kind: 'ignore' };
  if (expansionParts.some(part => part === 'dynamic')) {
    return { kind: 'shadow', name, commands: [...state.commands] };
  }
  const position = state.position ?? (state.commands.length > 0 ? 'anywhere' : 'command');
  if (state.commands.length > 0 && position === 'command') return { kind: 'ignore' };
  return {
    kind: 'add',
    abbr: {
      name,
      expansion: expansionParts.join(' '),
      position,
      commands: [...state.commands],
      ...state.cursorSeen ? { cursorMarker: state.cursorMarker } : {},
      source,
    },
  };
}

let parserPromise: Promise<Parser> | undefined;

function sharedParser(): Promise<Parser> {
  // Imported on use so this module can load without pulling the parser (and the
  // server cycle behind it) at startup.
  parserPromise ??= import('../parser').then(({ initializeParser }) => initializeParser()).catch(error => {
    parserPromise = undefined;
    throw error;
  });
  return parserPromise;
}

function report(message: string, error: unknown): void {
  void import('../logger').then(({ logger }) => logger.warning(message, error)).catch(() => undefined);
}

/** `config.fish` and `conf.d/*.fish`. Other fish files are not startup config. */
export function isFishConfigPath(filePath: string): boolean {
  if (!filePath.endsWith('.fish')) return false;
  if (basename(filePath) === 'config.fish') return true;
  return basename(dirname(filePath)) === 'conf.d';
}

/**
 * Fish reads `$__fish_config_dir`, otherwise `$XDG_CONFIG_HOME/fish`, otherwise
 * `~/.config/fish`.
 */
export function resolveFishConfigDir(configured = process.env.__fish_config_dir): string | undefined {
  if (configured) return configured;
  const home = process.env.HOME || homedir();
  if (process.env.XDG_CONFIG_HOME) return join(process.env.XDG_CONFIG_HOME, 'fish');
  if (home) return join(home, '.config', 'fish');
  return undefined;
}

export function readAbbreviationFile(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') return undefined;
    throw error;
  }
}

function confdFishFiles(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter(name => !name.startsWith('.') && name.endsWith('.fish'))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map(name => join(dir, name));
}

/**
 * User snippets in `conf.d` are read in natural filename order, then `config.fish`,
 * matching the order fish sources them. Vendor and system snippets are not read.
 */
export function abbreviationConfigFiles(dir: string): string[] {
  return [...confdFishFiles(join(dir, 'conf.d')), join(dir, 'config.fish')];
}

export async function readAbbreviationsFromDirectory(
  dir: string,
  readText: AbbreviationReader = readAbbreviationFile,
): Promise<FishAbbreviation[]> {
  const parser = await sharedParser();
  const set = new AbbreviationSet();
  for (const file of abbreviationConfigFiles(dir)) {
    const text = readText(file);
    if (text === undefined || text === null) continue;
    try {
      const tree = parser.parse(text);
      try {
        applyTree(tree.rootNode, set);
      } finally {
        tree.delete();
      }
    } catch (error) {
      report(`failed to parse abbreviations in ${file}`, error);
    }
  }
  return set.list();
}

/** Keeps the previous abbreviations when a reload throws. */
export class AbbreviationStore {
  abbreviations: FishAbbreviation[] = [];

  async reload(dir: string, readText: AbbreviationReader = readAbbreviationFile): Promise<void> {
    try {
      this.abbreviations = await readAbbreviationsFromDirectory(dir, readText);
    } catch (error) {
      report('failed to reload fish abbreviations', error);
    }
  }
}
