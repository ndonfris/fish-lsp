import { SyncFileHelper } from '../src/utils/fileOperations';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';
import * as fsPromises from 'fs/promises';
import { pathToUri } from '../src/utils/translation';
import { setLogger } from './helpers';

// Define a test directory and file paths
const testDir = join(__dirname, 'test_files');
const testFilePath = join(testDir, 'test_file.txt');
const testFilePathWithTilde = '~/repos/fish-lsp/test-data/test_files/test_file_tilde.txt';
setLogger()
// console.log(testDir);

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
    const expandedFilePath = testFilePathWithTilde.replace('~', process.env.HOME!);
    // console.log({testFilePathWithTilde, expandedFilePath});
    const { path, filename, extension, directory, uri,  exists} = SyncFileHelper.create(testFilePathWithTilde);
    // console.log({path, filename, extension, directory, uri, exists});
    expect(exists).toBe(true);
    expect(path).toBe(expandedFilePath);
    expect(filename).toBe('test_file_tilde');
    expect(extension).toBe('txt');
  });

  it('should expand env variables', () => {
    const pathWithEnvVariable = `$HOME/.config/fish/config.fish`
    const newPath = SyncFileHelper.expandEnvVars(pathWithEnvVariable)
    const expectedPath = `${homedir()}/.config/fish/config.fish`
    expect(expectedPath).toBe(newPath)
  })

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
    const expectedContent = `\nfunction test_file\n\techo "This is a test function."\nend`;
    const readData = SyncFileHelper.read(testFilePath);
    // console.log({readData, expectedContent});
    expect(readData).toBe(expectedContent);
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
});
