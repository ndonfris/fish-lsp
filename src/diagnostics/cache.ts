import { Diagnostic, DocumentUri } from 'vscode-languageserver';

/**
 * Simplified diagnostic cache that stores the current diagnostics for each document.
 * This allows code actions and other features to access the latest diagnostics without
 * needing to recompute them.
 *
 * Note: This cache only stores diagnostics; it does not send them to the client.
 * The server is responsible for calling connection.sendDiagnostics().
 */
export class DiagnosticCache {
  private cache: Map<DocumentUri, Diagnostic[]> = new Map();

  /**
   * Get the cached diagnostics for a document
   */
  getDiagnostics(documentUri: DocumentUri): Diagnostic[] {
    return this.cache.get(documentUri) || [];
  }

  /**
   * Set/update the cached diagnostics for a document
   */
  set(documentUri: DocumentUri, diagnostics: Diagnostic[]): void {
    this.cache.set(documentUri, diagnostics);
  }

  /**
   * Remove cached diagnostics for a document
   */
  delete(documentUri: DocumentUri): void {
    this.cache.delete(documentUri);
  }

  /**
   * Clear all cached diagnostics
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Check if diagnostics are cached for a document
   */
  has(documentUri: DocumentUri): boolean {
    return this.cache.has(documentUri);
  }
}
