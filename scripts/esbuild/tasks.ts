// Individual build task functions
import { logger } from './colors';
import { generateEmbeddedAssetsTypesOnly } from '../generate-embedded-assets-and-types';
import { generateTypeDeclarations } from './utils';

/**
 * Build setup files: tests/setup-mocks.ts and src/types/embedded-assets.d.ts
 */
export function buildSetup(): void {
  console.log(logger.header('⚙️  Setup Build'));
  console.log('  ' + logger.building('tests/setup-mocks.ts and src/types/embedded-assets.d.ts'));
  
  try {
    generateEmbeddedAssetsTypesOnly();
    console.log('  ' + logger.complete('setup files generation'));
  } catch (error) {
    console.log('  ' + logger.failed('setup files generation'));
    if (error instanceof Error) {
      logger.logError('Setup build failed:', error);
    }
    throw error;
  }
}

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