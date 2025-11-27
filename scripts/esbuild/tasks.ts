// Individual build task functions
import { logger } from './colors';
import { generateTypeDeclarations } from './utils';

/**
 * Build TypeScript declarations: dist/fish-lsp.d.ts
 */
export function buildTypes(): void {
  console.log(logger.header('📦 Types Build'));
  console.log('  ' + logger.building('dist/fish-lsp.d.ts'));
  
  try {
    generateTypeDeclarations();
    console.log('  ' + logger.complete('TypeScript declarations'));
  } catch (error) {
    console.log('  ' + logger.failed('TypeScript declarations'));
    if (error instanceof Error) {
      logger.logError('Types build failed:', error);
    }
    throw error;
  }
}
