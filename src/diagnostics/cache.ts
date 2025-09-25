
import { analyzer } from '../analyze';
import { LspDocument } from '../document';
import { Diagnostic, DocumentUri } from 'vscode-languageserver';
import { getDiagnostics } from './validate';
import { connection } from '../utils/startup';

export interface DiagnosticCacheEntry {
  document: LspDocument;
  diagnostics: Diagnostic[];
  timer: NodeJS.Timeout;
}

// Function to compare two diagnostics for equality
export function diagnosticsEqual(a: Diagnostic, b: Diagnostic): boolean {
  return a.code === b.code &&
    a.severity === b.severity &&
    a.source === b.source &&
    a.message === b.message &&
    a.range.start.line === b.range.start.line &&
    a.range.start.character === b.range.start.character &&
    a.range.end.line === b.range.end.line &&
    a.range.end.character === b.range.end.character &&
    a.relatedInformation === b.relatedInformation;
}

const isFishLspDiagnostic = (diag: Diagnostic, allDiagnostics: Diagnostic[]) => {
  return (
    diag.source === 'fish-lsp' &&
    !allDiagnostics.some(existing => diagnosticsEqual(existing, diag)) // make sure not already present
  );
};

export class DiagnosticCache {
  private cache: Map<DocumentUri, DiagnosticCacheEntry> = new Map();

  getDiagnostics(documentUri: DocumentUri): Diagnostic[] {
    const entry = this.cache.get(documentUri);
    if (!entry) return [];
    return entry.diagnostics;
  }

  set(documentUri: DocumentUri) {
    const entry = this.cache.get(documentUri);

    if (entry) {
      clearTimeout(entry.timer);
    }

    const diagnostics: Diagnostic[] = [];
    const root = analyzer.getRootNode(documentUri);
    const doc = analyzer.getDocument(documentUri);
    const timer = setTimeout(() => {
      if (!root || !doc) return;
      diagnostics.push(...getDiagnostics(root, doc).filter(d =>
        isFishLspDiagnostic(d, entry ? entry.diagnostics : []),
      )); // Only include fish-lsp diagnostics
      connection.sendDiagnostics({ uri: documentUri, diagnostics });
    }, 100);
    if (!doc) return;
    this.cache.set(documentUri, {
      document: doc,
      diagnostics,
      timer,
    });
  }

  setInitial(documentUri: DocumentUri) {
    const root = analyzer.getRootNode(documentUri);
    const doc = analyzer.getDocument(documentUri);
    if (!doc || !root) return;

    if (this.cache.has(documentUri)) {
      clearTimeout(this.cache.get(documentUri)!.timer);
    }

    // Use setImmediate for 'as-soon-as-possible' execution after I/O
    const diagnostics: Diagnostic[] = getDiagnostics(root, doc);

    // Send diagnostics INSIDE the callback
    if (connection) {
      connection.sendDiagnostics({ uri: documentUri, diagnostics });
    }

    this.cache.set(documentUri, {
      document: doc,
      diagnostics,
      timer: setImmediate(() => { /* no-op timer */ }) as any as NodeJS.Timeout,
    });
  }

  bindDiagnostics(documentUri: DocumentUri) {
    this.set(documentUri);
    return this.getDiagnostics(documentUri);
  }

  delete(documentUri: DocumentUri): void {
    this.cache.delete(documentUri);
  }

  clear(): void {
    this.cache.clear();
  }
}

