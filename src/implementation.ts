import { SyntaxNode } from 'web-tree-sitter';
import * as LSP from 'vscode-languageserver';
import { LspDocument } from './document';
import { analyzer } from './analyze';
import { findParentCommand, isCommandWithName } from './utils/node-types';
import { rangeContainsPosition } from './parsing/equality-utils';
import * as Locations from './utils/locations';
import { isPositionWithinRange } from './utils/tree-sitter';
import { FishSymbol } from './parsing/symbol';

export type ImplementationCanididate = {
  kind: 'definition' | 'completion' | 'usage';
  node: SyntaxNode;
  uri: string;
  range: LSP.Range;
};

function implementationCandidates(
  document: LspDocument,
  position: LSP.Position,
  resolvedSymbol: FishSymbol,
): ImplementationCanididate[] {
  return analyzer.getReferences(document, position)
    .map(loc => {
      // Classify as 'definition' only when the symbol at this location is
      // the *resolved* symbol itself. Otherwise a sibling local def in
      // another file (e.g. each --no-scope-shadowing function's own
      // `set var`, or B's `--inherit-variable VAR` declaration that
      // points back at A's `set VAR`) gets misclassified as a definition
      // of our symbol and the def↔usage cycle returns the wrong leg.
      const symbolAtLoc = analyzer.getSymbolAtLocation(loc);
      if (symbolAtLoc && symbolAtLoc.equals(resolvedSymbol)) {
        return {
          kind: 'definition' as const,
          node: symbolAtLoc.node,
          uri: loc.uri,
          range: loc.range,
        };
      }
      // A different symbol lives at this location — it's a reference site
      // that happens to be the def of its *own* symbol (e.g. B's
      // `--inherit-variable VAR`, or each --no-scope-shadowing callee's
      // local `set var`). Keep it as a 'usage' candidate so the cursor's
      // kind can still be determined and the cycle can fire correctly.
      if (symbolAtLoc) {
        return {
          kind: 'usage' as const,
          node: symbolAtLoc.node,
          uri: loc.uri,
          range: loc.range,
        };
      }
      const node = analyzer.nodeAtPoint(loc.uri, loc.range.start.line, loc.range.start.character);
      if (!node) return null;
      const cmd = findParentCommand(node);
      if (cmd && isCommandWithName(cmd, 'complete')) {
        return {
          kind: 'completion' as const,
          node,
          uri: loc.uri,
          range: loc.range,
        };
      }
      // Nodes without a parent command (e.g. tokens directly under a
      // `function_definition`) still represent usages — don't drop them
      // or the cursor's kind cannot be resolved.
      return {
        kind: 'usage' as const,
        node,
        uri: loc.uri,
        range: loc.range,
      };
    }).filter((c) => !!c) as ImplementationCanididate[];
}

export namespace ImplementationCanididate {
  export function toLocation(candidate: ImplementationCanididate): LSP.Location {
    return {
      uri: candidate.uri,
      range: candidate.range,
    };
  }

  export function canidatesOfKind(candidates: ImplementationCanididate[], kind: ImplementationCanididate['kind']): ImplementationCanididate[] {
    return candidates.filter(c => c.kind === kind);
  }

  export function toLoggable(c: ImplementationCanididate) {
    return {
      uri: c.uri, range: [c.range.start.line, c.range.start.character, c.range.end.line, c.range.end.character].join(','), kind: c.kind, node: {
        type: c.node.type,
        text: c.node.text,
      },
      line: analyzer.getDocument(c.uri)?.getLine(c.range.start.line),
    };
  }

  export function atLocation(document: LspDocument, position: LSP.Position): (c: ImplementationCanididate) => boolean {
    return (c: ImplementationCanididate) => c.uri === document.uri && rangeContainsPosition(c.range, position);
  }

  export function atCursor(canidates: ImplementationCanididate[], document: LspDocument, position: LSP.Position) {
    return canidates.filter(atLocation(document, position));
  }

  export function notAtCursor(canidates: ImplementationCanididate[], document: LspDocument, position: LSP.Position): boolean {
    return !atCursor(canidates, document, position);
  }

  export function ofKind(canidates: ImplementationCanididate[]): (kind: ImplementationCanididate['kind']) => ImplementationCanididate[] {
    return (kind: ImplementationCanididate['kind']) => canidates.filter(c => c.kind === kind);
  }

}

const ImplCycleLogic = (document: LspDocument, position: LSP.Position) => {
  const symbol = analyzer.getDefinition(document, position);

  if (!symbol) return [];
  const candidates = implementationCandidates(document, position, symbol);

  const cursorKind = candidates.find(s =>
    s.uri === document.uri
    && isPositionWithinRange(position, s.range),
  )?.kind || 'unknown';

  const isAtCursor = ImplementationCanididate.atLocation(document, position);

  const candidatesOfKind = ImplementationCanididate.ofKind(candidates.filter(c => !isAtCursor(c)));

  const kindConfig = [
    {
      from: 'definition',
      callback: () => {
        if (symbol.isArgparse() || symbol.isFunction()) {
          const completions = candidatesOfKind('completion');
          if (completions.length > 0) return completions.map(c => Locations.Location.create(c.uri, c.range));
        }

        const usages = candidatesOfKind('usage');
        if (usages.length > 0) return usages.map(c => Locations.Location.create(c.uri, c.range));
        // No completion — fall back to getReferences so the cycle can still
        // move (e.g., `function bar` + `alias bb 'bar'`: cycle from the def
        // returns both the def and the alias body usage). When no usages exist
        // either (a truly lonely function), getReferences returns just the def.
        return analyzer.getReferences(document, position);
      },
    },
    {
      from: 'usage',
      callback: () => {
        return [symbol.toLocation()];
      },
    },
    {
      from: 'completion',
      callback: () => {
        return [symbol.toLocation()];
      },
    },
    {
      from: 'unknown',
      callback: () => {
        const usages = candidatesOfKind('usage');
        if (usages.length > 0) return usages.map(c => Locations.Location.create(c.uri, c.range));
        return [symbol.toLocation()];
      },
    },
  ];

  return kindConfig.find(c => c.from === cursorKind)?.callback() || [];
};

export const getImplementationLocations = (document: LspDocument, position: LSP.Position): LSP.Location[] => {
  return ImplCycleLogic(document, position);
};
