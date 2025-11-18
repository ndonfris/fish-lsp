/**
 * Test helpers for working with the TextDocuments singleton in tests.
 *
 * The new TextDocuments implementation from vscode-languageserver doesn't expose
 * methods like `open()` or `clear()` - it's designed to work through connection events.
 *
 * These helpers simulate the document lifecycle events that would normally come from
 * a connected LSP client, allowing tests to manipulate the documents singleton.
 */

import { documents, LspDocument } from '../src/document';
import { DidOpenTextDocumentParams, DidChangeTextDocumentParams, DidCloseTextDocumentParams } from 'vscode-languageserver-protocol';

/**
 * Simulates opening a document in the LSP client.
 * This triggers the same flow as when a real client sends textDocument/didOpen.
 *
 * @param doc The document to open
 */
export function testOpenDocument(doc: LspDocument): void {
  const params: DidOpenTextDocumentParams = {
    textDocument: {
      uri: doc.uri,
      languageId: doc.languageId,
      version: doc.version,
      text: doc.getText(),
    },
  };

  // Access the private _syncedDocuments map to add the document
  // This simulates what happens when the onDidOpenTextDocument event fires
  const syncedDocs = (documents as any)._syncedDocuments as Map<string, LspDocument>;
  syncedDocs.set(doc.uri, doc);

  // Trigger the onDidOpen event
  const onDidOpenEmitter = (documents as any)._onDidOpen;
  if (onDidOpenEmitter) {
    onDidOpenEmitter.fire({ document: doc });
  }

  // Trigger the onDidChangeContent event (happens on open too)
  const onDidChangeContentEmitter = (documents as any)._onDidChangeContent;
  if (onDidChangeContentEmitter) {
    onDidChangeContentEmitter.fire({ document: doc });
  }
}

/**
 * Simulates closing a document in the LSP client.
 * This triggers the same flow as when a real client sends textDocument/didClose.
 *
 * @param uri The URI of the document to close
 */
export function testCloseDocument(uri: string): void {
  const doc = documents.get(uri);
  if (!doc) return;

  // Remove from synced documents
  const syncedDocs = (documents as any)._syncedDocuments as Map<string, LspDocument>;
  syncedDocs.delete(uri);

  // Trigger the onDidClose event
  const onDidCloseEmitter = (documents as any)._onDidClose;
  if (onDidCloseEmitter) {
    onDidCloseEmitter.fire({ document: doc });
  }
}

/**
 * Clears all documents from the TextDocuments singleton.
 * This is useful for test cleanup and resetting state between tests.
 */
export function testClearDocuments(): void {
  const syncedDocs = (documents as any)._syncedDocuments as Map<string, LspDocument>;

  // Get all URIs before clearing
  const allUris = Array.from(syncedDocs.keys());

  // Trigger close events for all documents
  for (const uri of allUris) {
    testCloseDocument(uri);
  }

  // Clear the map
  syncedDocs.clear();
}

/**
 * Simulates a document change event.
 * This is useful for testing edit scenarios.
 *
 * @param uri The URI of the document to change
 * @param newText The new text content
 * @param version Optional new version number
 */
export function testChangeDocument(uri: string, newText: string, version?: number): void {
  const doc = documents.get(uri);
  if (!doc) {
    throw new Error(`Document not found: ${uri}`);
  }

  // Update the document
  const newVersion = version ?? doc.version + 1;
  doc.update([{ text: newText }], newVersion);

  // Trigger the onDidChangeContent event
  const onDidChangeContentEmitter = (documents as any)._onDidChangeContent;
  if (onDidChangeContentEmitter) {
    onDidChangeContentEmitter.fire({ document: doc });
  }
}

/**
 * Gets the count of currently managed documents.
 * Useful for test assertions.
 *
 * @returns The number of documents currently managed
 */
export function testGetDocumentCount(): number {
  const syncedDocs = (documents as any)._syncedDocuments as Map<string, LspDocument>;
  return syncedDocs.size;
}

/**
 * Checks if a document is currently managed by the TextDocuments singleton.
 *
 * @param uri The URI to check
 * @returns true if the document is managed
 */
export function testHasDocument(uri: string): boolean {
  return documents.get(uri) !== undefined;
}
