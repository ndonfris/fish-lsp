import { SyncFileHelper, AsyncFileHelper } from '../src/utils/file-operations';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, unlinkSync, mkdirSync, rmdirSync, readFileSync, statSync } from 'fs';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import { pathToUri } from '../src/utils/translation';
import { setLogger } from './helpers';
import { vi } from 'vitest';
import { logger } from '../src/logger';

// Define a test directory and file paths
const testDir = join(__dirname, 'fish_files');
const tildeTestDir = testDir.replace(process.env.HOME!, '~')!;
const testFilePath = join(testDir, 'test_file.txt');
const testFilePathWithTilde = `${tildeTestDir}/test_file_tilde.txt`;

setLogger();

// console.log({testDir, testFilePath, testFilePathWithTilde, tildeTestDir});

// Helper function to clean up test files
const cleanUpTestFile = (filePath: string) => {
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
};

describe('SyncFileHelper', () => {
  beforeAll(() => {
    // Ensure the test directory exists
    if (!existsSync(testDir)) {
      fsPromises.mkdir(testDir, { recursive: true });
    }
  });

  afterAll(() => {
    // Clean up the test files after all tests
    cleanUpTestFile(testFilePath);
    cleanUpTestFile(testFilePathWithTilde.replace('~', process.env.HOME!));
  });

  it('should create a file if it does not exist', () => {
    const { path, filename, extension } = SyncFileHelper.create(testFilePath);
    expect(SyncFileHelper.exists(testFilePath)).toBe(true);
    expect(path).toBe(testFilePath);
    expect(filename).toBe('test_file');
    expect(extension).toBe('txt');
  });

  it('should return path tokens for existing directory', () => {
    const result = SyncFileHelper.create(testDir);
    expect(result.path).toBe(testDir);
    expect(result.exists).toBe(true);
    expect(SyncFileHelper.isDirectory(result.path)).toBe(true);
  });

  it('should write data to a file', () => {
    const data = 'Hello, world!';
    SyncFileHelper.write(testFilePath, data);
    const readData = SyncFileHelper.read(testFilePath);
    expect(readData).toBe(data);
  });

  it('should append data to a file', () => {
    const appendData = ' Appended text.';
    SyncFileHelper.append(testFilePath, appendData);
    const readData = SyncFileHelper.read(testFilePath);
    expect(readData).toBe('Hello, world!' + appendData);
  });

  it('should delete a file', () => {
    SyncFileHelper.delete(testFilePath);
    expect(SyncFileHelper.exists(testFilePath)).toBe(false);
  });

  it('should expand tilde to home directory and create a file', () => {
    const expandedFilePath = testFilePathWithTilde.replace(/^~/, process.env.HOME!);
    const expandedDirFilePath = expandedFilePath.slice(0, expandedFilePath.lastIndexOf('/'));
    const { exists, extension, path, filename, directory } = SyncFileHelper.create(testFilePathWithTilde);
    expect(exists).toBe(true);
    expect(path).toBe(expandedFilePath);
    expect(directory).toBe(expandedDirFilePath);
    expect(filename).toBe('test_file_tilde');
    expect(extension).toBe('txt');
  });

  it('test isDirectory working', () => {
    expect(SyncFileHelper.isDirectory(tildeTestDir)).toBe(true);
    expect(SyncFileHelper.isDirectory(testFilePathWithTilde)).toBe(false);
    expect(SyncFileHelper.isDirectory(testDir)).toBe(true);
    expect(SyncFileHelper.isDirectory(testFilePath)).toBe(false);
  });

  it('should expand env variables', () => {
    const pathWithEnvVariable = '$HOME/.config/fish/config.fish';
    const newPath = SyncFileHelper.expandEnvVars(pathWithEnvVariable);
    const expectedPath = `${homedir()}/.config/fish/config.fish`;
    expect(expectedPath).toBe(newPath);
  });

  /*
   * it('test $fish_function_path works?', () => {
   *  // `echo $fish_function_path`
   *  //  • Some documentation is available:
   *  //        >_ man -a fish-interactive # then scroll down to section: TAB COMPLETION
   *  //        # https://fishshell.com/docs/current/language.html#autoloading-functions
   *  const pathWithEnvVariable = `$fish_function_path`
   *  const newPath = SyncFileHelper.expandEnvVars(pathWithEnvVariable)
   *  const expectedPath = `${homedir()}/.config/fish/functions/`
   *  console.log(newPath);
   *  // expect(expectedPath).toBe(newPath)
   * })
   */

  it('should convert file content to Fish function', () => {
    const data = 'echo "This is a test function."';
    SyncFileHelper.convertTextToFishFunction(testFilePath, data);
    const expectedContent = '\nfunction test_file\n\techo "This is a test function."\nend';
    const readData = SyncFileHelper.read(testFilePath);
    // console.log({ readData, expectedContent });
    expect(readData).toBe(expectedContent);
  });

  it('should append to existing file when converting to Fish function', () => {
    // Create an existing file first
    SyncFileHelper.write(testFilePath, 'existing content\n');
    const data = 'echo "Appended function"';
    const doc = SyncFileHelper.convertTextToFishFunction(testFilePath, data);

    const readData = SyncFileHelper.read(testFilePath);
    expect(readData).toContain('existing content');
    expect(readData).toContain('\nfunction test_file\n\techo "Appended function"\nend');
    expect(doc).toBeDefined();
    expect(doc.languageId).toBe('txt'); // extension from test_file.txt
  });

  it('should convert file content to TextDocumentItem', () => {
    const textDocItem = SyncFileHelper.toTextDocumentItem(testFilePath, 'plaintext', 1);
    expect(textDocItem.uri).toBe(pathToUri(testFilePath));
    expect(textDocItem.languageId).toBe('plaintext');
    expect(textDocItem.version).toBe(1);
    expect(textDocItem.text).toBe(SyncFileHelper.read(testFilePath));
  });

  it('should convert file content to LspDocument', () => {
    const lspDoc = SyncFileHelper.toLspDocument(testFilePath, 'plaintext', 1);
    expect(lspDoc.uri).toBe(pathToUri(testFilePath));
    expect(lspDoc.languageId).toBe('plaintext');
    expect(lspDoc.version).toBe(1);
    expect(lspDoc.getText()).toBe(SyncFileHelper.read(testFilePath));
  });

  it('should handle empty file when converting to LspDocument', () => {
    const emptyFilePath = join(testDir, 'empty_file.fish');
    SyncFileHelper.write(emptyFilePath, '');
    const lspDoc = SyncFileHelper.toLspDocument(emptyFilePath);
    expect(lspDoc.getText()).toBe('');
    expect(lspDoc.languageId).toBe('fish'); // default language
    cleanUpTestFile(emptyFilePath);
  });

  it('should handle non-existent file when converting to LspDocument', () => {
    logger.setSilent(true);
    const nonExistentPath = join(testDir, 'non-existent-for-lsp.fish');
    const lspDoc = SyncFileHelper.toLspDocument(nonExistentPath);
    expect(lspDoc.getText()).toBe('');
    expect(lspDoc.languageId).toBe('fish');
    logger.setSilent(false);
  });

  describe('expandNormalize', () => {
    it('should expand environment variables and normalize path', () => {
      const pathWithEnvVar = '$HOME/.config/fish/config.fish';
      const result = SyncFileHelper.expandNormalize(pathWithEnvVar);
      const expected = `${homedir()}/.config/fish/config.fish`;
      expect(result).toBe(expected);
    });

    it('should expand tilde and normalize path', () => {
      const pathWithTilde = '~/Documents/test.fish';
      const result = SyncFileHelper.expandNormalize(pathWithTilde);
      const expected = `${process.env.HOME}/Documents/test.fish`;
      expect(result).toBe(expected);
    });

    it('should normalize redundant separators', () => {
      const pathWithRedundantSeps = '/home//user///Documents/file.fish';
      const result = SyncFileHelper.expandNormalize(pathWithRedundantSeps);
      expect(result).toBe('/home/user/Documents/file.fish');
    });

    it('should normalize . and .. in absolute paths', () => {
      const pathWithDots = '/home/user/./Documents/../Downloads/file.fish';
      const result = SyncFileHelper.expandNormalize(pathWithDots);
      expect(result).toBe('/home/user/Downloads/file.fish');
    });

    it('should normalize . and .. in relative paths', () => {
      const pathWithDots = './foo/../bar/./baz.fish';
      const result = SyncFileHelper.expandNormalize(pathWithDots);
      expect(result).toBe('bar/baz.fish');
    });

    it('should preserve relative path starting with ./', () => {
      const relativePath = './scripts/test.fish';
      const result = SyncFileHelper.expandNormalize(relativePath);
      expect(result).toBe('scripts/test.fish');
      // Note: path.normalize removes leading ./ when there are no other dots
    });

    it('should preserve relative path starting with ../', () => {
      const relativePath = '../parent/file.fish';
      const result = SyncFileHelper.expandNormalize(relativePath);
      expect(result).toBe('../parent/file.fish');
    });

    it('should handle complex path with env vars and normalization', () => {
      const complexPath = '$HOME/./Documents/../Downloads//file.fish';
      const result = SyncFileHelper.expandNormalize(complexPath);
      const expected = `${process.env.HOME}/Downloads/file.fish`;
      expect(result).toBe(expected);
    });

    it('should handle relative paths with env vars', () => {
      // Use an existing env var like HOME in a relative context
      // Note: $HOME expands to an absolute path like /home/user,
      // so ./subdir/$HOME becomes ./subdir/home/user which normalizes to subdir/home/user
      const pathWithEnvVar = './subdir/$HOME/file.fish';
      const result = SyncFileHelper.expandNormalize(pathWithEnvVar);
      // After expansion: ./subdir//home/ndonfris/file.fish
      // After normalization: subdir/home/ndonfris/file.fish (removes ./ and //)
      const homeWithoutLeadingSlash = process.env.HOME!.replace(/^\//, '');
      expect(result).toBe(`subdir/${homeWithoutLeadingSlash}/file.fish`);
    });

    it('should preserve absolute path semantics', () => {
      const absolutePath = '/absolute/path/to/file.fish';
      const result = SyncFileHelper.expandNormalize(absolutePath);
      expect(result).toBe('/absolute/path/to/file.fish');
    });

    it('should handle paths with multiple environment variables', () => {
      // Use HOME twice since it's available in the test environment
      // $HOME/subdir/$HOME/file.fish → /home/user/subdir//home/user/file.fish
      // After normalization: /home/user/subdir/home/user/file.fish (// → /)
      const pathWithMultipleEnvVars = '$HOME/subdir/$HOME/file.fish';
      const result = SyncFileHelper.expandNormalize(pathWithMultipleEnvVars);
      const homeWithoutLeadingSlash = process.env.HOME!.replace(/^\//, '');
      const expected = `${process.env.HOME}/subdir/${homeWithoutLeadingSlash}/file.fish`;
      expect(result).toBe(expected);
    });

    it('should handle tilde with additional path components containing dots', () => {
      const pathWithTildeAndDots = '~/.config/../.local/./share/fish/config.fish';
      const result = SyncFileHelper.expandNormalize(pathWithTildeAndDots);
      const expected = `${process.env.HOME}/.local/share/fish/config.fish`;
      expect(result).toBe(expected);
    });

    it('should normalize trailing slashes', () => {
      const pathWithTrailingSlash = '/home/user/Documents/';
      const result = SyncFileHelper.expandNormalize(pathWithTrailingSlash);
      // Note: path.normalize() preserves trailing slashes on Linux
      expect(result).toBe('/home/user/Documents/');
    });

    it('should handle empty path', () => {
      const emptyPath = '';
      const result = SyncFileHelper.expandNormalize(emptyPath);
      expect(result).toBe('.');
    });

    it('should handle current directory', () => {
      const currentDir = '.';
      const result = SyncFileHelper.expandNormalize(currentDir);
      expect(result).toBe('.');
    });

    it('should handle parent directory', () => {
      const parentDir = '..';
      const result = SyncFileHelper.expandNormalize(parentDir);
      expect(result).toBe('..');
    });
  });

  describe('open and close', () => {
    it('should open and close a file descriptor', () => {
      const fd = SyncFileHelper.open(testFilePath, 'r');
      expect(typeof fd).toBe('number');
      expect(fd).toBeGreaterThanOrEqual(0);
      SyncFileHelper.close(fd);
    });

    it('should open file with expanded path', () => {
      const fd = SyncFileHelper.open(testFilePathWithTilde, 'r');
      expect(typeof fd).toBe('number');
      SyncFileHelper.close(fd);
    });
  });

  describe('loadDocumentSync', () => {
    it('should load a document from a file path', () => {
      SyncFileHelper.write(testFilePath, 'test content');
      const doc = SyncFileHelper.loadDocumentSync(testFilePath);
      expect(doc).toBeDefined();
      expect(doc?.getText()).toBe('test content');
      expect(doc?.uri).toBe(pathToUri(testFilePath));
    });

    it('should return undefined for non-existent file', () => {
      const nonExistentPath = join(testDir, 'non-existent-file.fish');
      const doc = SyncFileHelper.loadDocumentSync(nonExistentPath);
      expect(doc).toBeUndefined();
    });

    it('should return undefined for directory', () => {
      const doc = SyncFileHelper.loadDocumentSync(testDir);
      expect(doc).toBeUndefined();
    });

    it('should handle errors gracefully', () => {
      const originalConsoleLog = console.log;
      logger.setSilent(true);
      console.log = vi.fn(); // Mock console.log to suppress output during test
      const invalidPath = '/root/totally-inaccessible/file.fish';
      const doc = SyncFileHelper.loadDocumentSync(invalidPath);
      expect(doc).toBeUndefined();
      console.log = originalConsoleLog; // Restore original console.log
      logger.setSilent(false);
    });

    // Note: The catch block in loadDocumentSync (lines 57-61) is defensive error handling
    // that's difficult to test without complex mocking of ES modules.
    // It handles unexpected errors during file reading that aren't caught by earlier checks.
    // The function is well-tested for all normal error paths (non-existent files, directories, etc.)
  });

  describe('writeRecursive', () => {
    const recursiveTestDir = join(testDir, 'nested', 'deep', 'directory');
    const recursiveTestFile = join(recursiveTestDir, 'test.fish');

    afterAll(() => {
      // Clean up nested directories
      try {
        if (existsSync(recursiveTestFile)) unlinkSync(recursiveTestFile);
        if (existsSync(recursiveTestDir)) rmdirSync(recursiveTestDir);
        if (existsSync(join(testDir, 'nested', 'deep'))) rmdirSync(join(testDir, 'nested', 'deep'));
        if (existsSync(join(testDir, 'nested'))) rmdirSync(join(testDir, 'nested'));
      } catch (e) {
        // Ignore cleanup errors
      }
    });

    it('should create directories recursively and write file', () => {
      const content = 'recursively written content';
      SyncFileHelper.writeRecursive(recursiveTestFile, content);
      expect(SyncFileHelper.exists(recursiveTestFile)).toBe(true);
      expect(SyncFileHelper.read(recursiveTestFile)).toBe(content);
    });

    it('should handle errors in writeRecursive gracefully', () => {
      logger.setSilent(true);
      // Try to write to an invalid location
      const invalidPath = '/root/cannot-write-here/file.fish';
      expect(() => {
        SyncFileHelper.writeRecursive(invalidPath, 'content');
      }).not.toThrow();
      logger.setSilent(false);
    });
  });

  describe('read error cases', () => {
    it('should return empty string when reading a directory', () => {
      const content = SyncFileHelper.read(testDir);
      expect(content).toBe('');
    });

    it('should handle read errors gracefully', () => {
      logger.setSilent(true);
      const nonExistentFile = join(testDir, 'does-not-exist.fish');
      const content = SyncFileHelper.read(nonExistentFile);
      expect(content).toBe('');
      logger.setSilent(false);
    });
  });

  describe('isExpandable', () => {
    it('should return true for path with tilde', () => {
      expect(SyncFileHelper.isExpandable('~/test.fish')).toBe(true);
    });

    it('should return true for path with env var', () => {
      expect(SyncFileHelper.isExpandable('$HOME/test.fish')).toBe(true);
    });

    it('should return false for regular path', () => {
      expect(SyncFileHelper.isExpandable('/regular/path.fish')).toBe(false);
    });

    it('should return false for empty expansion', () => {
      expect(SyncFileHelper.isExpandable('$NONEXISTENT_VAR')).toBe(false);
    });
  });

  describe('isFile', () => {
    it('should return true for existing file', () => {
      SyncFileHelper.write(testFilePath, 'content');
      expect(SyncFileHelper.isFile(testFilePath)).toBe(true);
    });

    it('should return false for directory', () => {
      expect(SyncFileHelper.isFile(testDir)).toBe(false);
    });

    it('should return false for non-existent path', () => {
      expect(SyncFileHelper.isFile('/non/existent/path.fish')).toBe(false);
    });
  });

  describe('isWriteable methods', () => {
    it('should check if directory is writeable', () => {
      expect(SyncFileHelper.isWriteableDirectory(testDir)).toBe(true);
    });

    it('should return false for non-existent directory', () => {
      expect(SyncFileHelper.isWriteableDirectory('/non/existent/dir')).toBe(false);
    });

    it('should return false if path is file not directory', () => {
      SyncFileHelper.write(testFilePath, 'content');
      expect(SyncFileHelper.isWriteableDirectory(testFilePath)).toBe(false);
    });

    it('should check if file is writeable', () => {
      SyncFileHelper.write(testFilePath, 'content');
      expect(SyncFileHelper.isWriteableFile(testFilePath)).toBe(true);
    });

    it('should return false for non-existent file', () => {
      expect(SyncFileHelper.isWriteableFile('/non/existent/file.fish')).toBe(false);
    });

    it('should return false if path is directory not file', () => {
      expect(SyncFileHelper.isWriteableFile(testDir)).toBe(false);
    });

    it('should check if path is writeable (generic)', () => {
      expect(SyncFileHelper.isWriteable(testDir)).toBe(true);
      SyncFileHelper.write(testFilePath, 'content');
      expect(SyncFileHelper.isWriteable(testFilePath)).toBe(true);
    });

    it('should return false for non-writeable path', () => {
      expect(SyncFileHelper.isWriteable('/root/cannot-write.fish')).toBe(false);
    });
  });

  describe('isAbsolutePath and isRelativePath', () => {
    it('should identify absolute paths', () => {
      expect(SyncFileHelper.isAbsolutePath('/absolute/path.fish')).toBe(true);
      expect(SyncFileHelper.isAbsolutePath('~/home/path.fish')).toBe(true);
    });

    it('should identify relative paths', () => {
      expect(SyncFileHelper.isRelativePath('./relative/path.fish')).toBe(true);
      expect(SyncFileHelper.isRelativePath('../parent/path.fish')).toBe(true);
      expect(SyncFileHelper.isRelativePath('relative/path.fish')).toBe(true);
    });

    it('should handle paths with env vars', () => {
      expect(SyncFileHelper.isAbsolutePath('$HOME/path.fish')).toBe(true);
      expect(SyncFileHelper.isRelativePath('./path.fish')).toBe(true);
    });
  });
});

describe('AsyncFileHelper', () => {
  const testDir = join(__dirname, 'fish_files');
  const testFilePath = join(testDir, 'async_test_file.txt');

  beforeAll(async () => {
    if (!existsSync(testDir)) {
      await fsPromises.mkdir(testDir, { recursive: true });
    }
  });

  afterAll(async () => {
    try {
      if (existsSync(testFilePath)) {
        await fsPromises.unlink(testFilePath);
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('isReadable', () => {
    it('should return true for readable file', async () => {
      await fsPromises.writeFile(testFilePath, 'content');
      const result = await AsyncFileHelper.isReadable(testFilePath);
      expect(result).toBe(true);
    });

    it('should return false for non-existent file', async () => {
      const result = await AsyncFileHelper.isReadable('/non/existent/file.fish');
      expect(result).toBe(false);
    });

    it('should expand env vars before checking', async () => {
      await fsPromises.writeFile(testFilePath, 'content');
      const tildeTestPath = testFilePath.replace(process.env.HOME!, '~');
      const result = await AsyncFileHelper.isReadable(tildeTestPath);
      expect(result).toBe(true);
    });
  });

  describe('isDir', () => {
    it('should return true for directory', async () => {
      const result = await AsyncFileHelper.isDir(testDir);
      expect(result).toBe(true);
    });

    it('should return false for file', async () => {
      await fsPromises.writeFile(testFilePath, 'content');
      const result = await AsyncFileHelper.isDir(testFilePath);
      expect(result).toBe(false);
    });

    it('should return false for non-existent path', async () => {
      const result = await AsyncFileHelper.isDir('/non/existent/dir');
      expect(result).toBe(false);
    });
  });

  describe('isFile', () => {
    it('should return true for file', async () => {
      await fsPromises.writeFile(testFilePath, 'content');
      const result = await AsyncFileHelper.isFile(testFilePath);
      expect(result).toBe(true);
    });

    it('should return false for directory', async () => {
      const result = await AsyncFileHelper.isFile(testDir);
      expect(result).toBe(false);
    });

    it('should return false for non-existent path', async () => {
      const result = await AsyncFileHelper.isFile('/non/existent/file.fish');
      expect(result).toBe(false);
    });
  });

  describe('readFile', () => {
    it('should read file content', async () => {
      const content = 'async test content';
      await fsPromises.writeFile(testFilePath, content);
      const result = await AsyncFileHelper.readFile(testFilePath);
      expect(result).toBe(content);
    });

    it('should read file with custom encoding', async () => {
      const content = 'async test content';
      await fsPromises.writeFile(testFilePath, content);
      const result = await AsyncFileHelper.readFile(testFilePath, 'utf8');
      expect(result).toBe(content);
    });

    it('should expand env vars before reading', async () => {
      const content = 'async test content';
      await fsPromises.writeFile(testFilePath, content);
      const tildeTestPath = testFilePath.replace(process.env.HOME!, '~');
      const result = await AsyncFileHelper.readFile(tildeTestPath);
      expect(result).toBe(content);
    });
  });
});
