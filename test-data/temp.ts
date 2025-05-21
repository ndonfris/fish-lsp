import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Workspace } from '../src/utils/workspace';
import { LspDocument } from '../src/document';
import { TextDocumentItem } from 'vscode-languageserver';
import { workspaceManager } from '../src/utils/workspace-manager';

interface TempFileResult {
  path: string;
  document: LspDocument;
  cleanup: () => void;
}

function createFakeLspDocument(document: TextDocumentItem) {
  // const doc = TextDocumentItem.create(document.uri, 'fish', 0, document.getText());
  const workspace = workspaceManager.findContainingWorkspace(document.uri);
  if (!workspace) {
    workspaceManager.add(Workspace.syncCreateFromUri(document.uri)!);
  } else {
    workspace.add(document.uri);
  }
  return new LspDocument(document);
}

/**
 * Create a temporary fish file for testing
 *
 * @param content The fish script content to write
 * @returns Object containing the file path, TextDocument, and cleanup function
 */
export function createTempFishFile(content: string): TempFileResult {
  // Create unique filename in temp directory
  const filename = `test-${Date.now()}-${Math.random().toString(36).slice(2)}.fish`;
  const filepath = join(tmpdir(), filename);

  // Write content to file
  writeFileSync(filepath, content, 'utf8');

  // Create TextDocument
  const document = TextDocumentItem.create(
    `file://${filepath}`,
    'fish',
    1,
    content,
  );

  const lspDocument = createFakeLspDocument(document);

  // Cleanup function
  const cleanup = () => {
    try {
      unlinkSync(filepath);
    } catch (err) {
      console.error(`Failed to cleanup temp file ${filepath}:`, err);
    }
  };

  return {
    path: filepath,
    document: lspDocument,
    cleanup,
  };
}

/**
 * Helper to run a test with a temporary fish file
 *
 * @param content Fish script content
 * @param testFn Function that receives the temp file info and runs test assertions
 */
export async function withTempFishFile(
  content: string,
  testFn: (result: TempFileResult) => Promise<void>,
): Promise<void> {
  const tempFile = createTempFishFile(content);
  try {
    await testFn(tempFile);
  } finally {
    tempFile.cleanup();
  }
}
