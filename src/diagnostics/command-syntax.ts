import { SyntaxNode } from 'web-tree-sitter';
import { namedNodesGen } from '../utils/tree-sitter';
import { ErrorCodes } from './error-codes';
import { FishDiagnostic } from './types';

/** Value-taking options needed to distinguish flags from their operands. Only
 * the requested subset is diagnosed; the others still consume their values. */
const OPTIONS: Record<string, Record<string, string>> = {
  function: { d: 'description', w: 'wraps', e: 'on-event', v: 'on-variable', j: 'on-job-exit', p: 'on-process-exit', s: 'on-signal', V: 'inherit-variable', a: 'argument-names' },
  complete: { c: 'command', p: 'path', s: 'short-option', l: 'long-option', o: 'old-option', a: 'arguments', d: 'description', w: 'wraps', n: 'condition' },
};

function commandArguments(node: SyntaxNode): { command: string; args: SyntaxNode[]; } | null {
  if (node.type === 'command') {
    const command = node.childForFieldName('name')?.text ?? '';
    if (!OPTIONS[command]) return null;
    return { command, args: node.childrenForFieldName('argument') };
  }
  // An unfinished function header is an ERROR rather than a function_definition.
  if (node.type !== 'function_definition' && !(node.isError && node.firstChild?.type === 'function')) return null;
  const header = [];
  for (const child of node.children.slice(1)) {
    if (child.type === '\n' || child.type === ';' || child.type === 'end') break;
    if (child.isNamed && child.type !== 'comment' && child.type !== 'escape_sequence') header.push(child);
  }
  return { command: 'function', args: header.slice(1) };
}

export function missingOptionValues(node: SyntaxNode): FishDiagnostic[] {
  const parsed = commandArguments(node);
  if (!parsed) return [];
  const { command } = parsed;
  const args = parsed.args.filter(arg => arg.type !== 'escape_sequence' && arg.type !== 'comment');
  const options = OPTIONS[command]!;
  const diagnostics: FishDiagnostic[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const text = arg.text;
    if (text === '--') break;
    // Quoted/expanded arguments are values, not statically identifiable flags.
    if (arg.type !== 'word' && arg.type !== 'concatenation') continue;
    let option: string | undefined;
    if (text.startsWith('--')) {
      const long = text.slice(2).split('=', 1)[0]!;
      if (!Object.values(options).includes(long)) continue;
      if (text.includes('=')) continue; // including an explicitly empty value
      option = long;
    } else if (/^-[^-]/.test(text)) {
      for (let offset = 1; offset < text.length; offset++) {
        const name = options[text[offset]!];
        if (!name) continue;
        // In -xdTEXT the rest of the token is the description, not more flags.
        if (offset === text.length - 1) option = name;
        break;
      }
    }
    if (!option) continue;
    // A following argument is a value even if it starts with '-': fish getopt
    // consumes it too. Never guess what a variable/substitution expands to.
    if (args[i + 1]) {
      i++; continue;
    }
    if (option !== 'description' && !(command === 'complete' && ['command', 'short-option', 'long-option'].includes(option))) continue;
    diagnostics.push(FishDiagnostic.create(ErrorCodes.missingOptionValue, arg, `${command}: ${text} requires a value`));
  }
  return diagnostics;
}

export function* commandSyntaxDiagnostics(root: SyntaxNode): Generator<FishDiagnostic> {
  const text = root.text;
  for (const match of text.matchAll(/(?:^|;)[\t ]*(&&|\|\|)/gm)) {
    const operator = match[1]!;
    const offset = match.index + match[0].length - operator.length;
    const node = root.descendantForIndex(root.startIndex + offset);
    // Strings, comments and escaped literals may contain the same text. The
    // parser sometimes recovers invalid && as two anonymous '&' tokens.
    if (!node.isError && (node.isNamed || !['&', '&&', '|', '||'].includes(node.type))) continue;
    // A broad recovery node (for example an unfinished quote) does not identify
    // this operator as syntax. Only diagnose a token at the actual offset.
    if (node.startIndex !== root.startIndex + offset) continue;
    const afterSemicolon = match[0].startsWith(';');
    if (afterSemicolon && root.descendantForIndex(root.startIndex + match.index).type !== ';') continue;
    const lineStart = match.index;
    if (!afterSemicolon && lineStart > 0) {
      const newline = root.descendantForIndex(root.startIndex + lineStart - 1);
      if (newline.type === 'escape_sequence' && /\\\r?\n$/.test(newline.text)) continue;
      // The grammar keeps CRLF's CR in a separate escape_sequence.
      if (text[lineStart - 2] === '\r') {
        const escapedCR = root.descendantForIndex(root.startIndex + lineStart - 2);
        if (escapedCR.type === 'escape_sequence' && escapedCR.text === '\\\r') continue;
      }
    }
    const replacement = operator === '&&' ? 'and' : 'or';
    const diagnostic = FishDiagnostic.create(ErrorCodes.leadingConditionalOperator, node, `Use '${replacement}' at the start of a statement, or escape the preceding newline`);
    diagnostic.range.end = { ...diagnostic.range.start, character: diagnostic.range.start.character + 2 };
    yield diagnostic;
  }
  for (const node of namedNodesGen(root)) yield* missingOptionValues(node);
}
