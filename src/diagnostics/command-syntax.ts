import { SyntaxNode } from 'web-tree-sitter';
import { ErrorCodes } from './error-codes';
import { FishDiagnostic } from './types';

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
}
