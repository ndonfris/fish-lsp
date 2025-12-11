/**
 * Test Workspace Utilities for Fish Language Server
 *
 * This utility provides a comprehensive framework for creating and managing
 * temporary fish shell workspaces in tests. It ensures that test fish files
 * behave exactly like production usage by integrating with the same analysis
 * pipeline used by the language server.
 *
 * @example Basic Usage
 * ```typescript
 * import { TestWorkspace, TestFile, Query } from './test-workspace-utils';
 *
 * describe('My Test', () => {
 *   const workspace = TestWorkspace.create()
 *     .addFiles(
 *       TestFile.function('greet', 'function greet\n  echo "Hello, $argv[1]!"\nend'),
 *       TestFile.completion('greet', 'complete -c greet -l help')
 *     ).initialize();
 *
 *   it('should find documents', () => {
 *     const doc = workspace.getDocument('greet.fish');
 *     expect(doc).toBeDefined();
 *   });
 *
 *   it('should support queries', () => {
 *     const functions = workspace.getDocuments(Query.functions());
 *     expect(functions).toHaveLength(1);
 *   });
 * });
 * ```
 *
 * @example Advanced Querying
 * ```typescript
 * // Get specific file types
 * workspace.getDocuments(Query.functions().withName('foo'));
 * workspace.getDocuments(Query.completions());
 * workspace.getDocuments(Query.autoloaded());
 *
 * // Complex queries
 * workspace.getDocuments(
 *   Query.functions().withName('foo'),
 *   Query.completions().withName('foo')
 * );
 * ```
 *
 * @example Predefined Workspaces
 * ```typescript
 * const workspace = DefaultTestWorkspaces.basicFunctions();
 * workspace.initialize();
 * ```
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { LspDocument, documents } from '../src/document';
import { Workspace } from '../src/utils/workspace';
import { workspaceManager } from '../src/utils/workspace-manager';
import { Analyzer, analyzer } from '../src/analyze';
import { pathToUri, uriToPath } from '../src/utils/translation';
import { logger, now } from '../src/logger';
import { SyncFileHelper } from '../src/utils/file-operations';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { execFileSync, execSync } from 'child_process';
import fastGlob from 'fast-glob';
import { Command } from 'commander';
import { testOpenDocument, testCloseDocument, testClearDocuments, testChangeDocument, testGetDocumentCount } from './document-test-helpers';

/**
 * Query builder for advanced document selection
 */
export class Query {
  private _filters: ((doc: LspDocument) => boolean)[] = [];
  private _returnFirst = false;

  private constructor() { }

  /**
   * Creates a new query
   */
  static create(): Query {
    return new Query();
  }

  /**
   * Filters for function files in functions/ directory
   */
  static functions(): Query {
    return new Query().functions();
  }

  /**
   * Filters for completion files in completions/ directory
   */
  static completions(): Query {
    return new Query().completions();
  }

  /**
   * Filters for config.fish files
   */
  static config(): Query {
    return new Query().config();
  }

  /**
   * Filters for conf.d files
   */
  static confd(): Query {
    return new Query().confd();
  }

  /**
   * Filters for script files (non-autoloaded)
   */
  static scripts(): Query {
    return new Query().scripts();
  }

  /**
   * Filters for any autoloaded files
   */
  static autoloaded(): Query {
    return new Query().autoloaded();
  }

  /**
   * Filters by file name
   */
  static withName(name: string): Query {
    return new Query().withName(name);
  }

  /**
   * Filters by path pattern
   */
  static withPath(...patterns: string[]): Query {
    return new Query().withPath(...patterns);
  }

  /**
   * Returns only the first match
   */
  static firstMatch(): Query {
    return new Query().firstMatch();
  }

  // Instance methods for chaining

  /**
   * Filters for function files in functions/ directory
   */
  functions(): Query {
    this._filters.push(doc => {
      const docPath = uriToPath(doc.uri);
      return docPath.includes('/functions/') && docPath.endsWith('.fish');
    });
    return this;
  }

  /**
   * Filters for completion files in completions/ directory
   */
  completions(): Query {
    this._filters.push(doc => {
      const docPath = uriToPath(doc.uri);
      return docPath.includes('/completions/') && docPath.endsWith('.fish');
    });
    return this;
  }

  /**
   * Filters for config.fish files
   */
  config(): Query {
    this._filters.push(doc => {
      const docPath = uriToPath(doc.uri);
      return path.basename(docPath) === 'config.fish';
    });
    return this;
  }

  /**
   * Filters for conf.d files
   */
  confd(): Query {
    this._filters.push(doc => {
      const docPath = uriToPath(doc.uri);
      return docPath.includes('/conf.d/') && docPath.endsWith('.fish');
    });
    return this;
  }

  /**
   * Filters for script files (non-autoloaded)
   */
  scripts(): Query {
    this._filters.push(doc => {
      const docPath = uriToPath(doc.uri);
      return (
        docPath.includes('/scripts/') ||
        !docPath.includes('/functions/') &&
        !docPath.includes('/completions/') &&
        !docPath.includes('/conf.d/') &&
        path.basename(docPath) !== 'config.fish'
      ) && docPath.endsWith('.fish');
    });
    return this;
  }

  /**
   * Filters for any autoloaded files
   */
  autoloaded(): Query {
    this._filters.push(doc => {
      const docPath = uriToPath(doc.uri);
      return (
        docPath.includes('/functions/') ||
        docPath.includes('/completions/') ||
        docPath.includes('/conf.d/') ||
        path.basename(docPath) === 'config.fish'
      ) && docPath.endsWith('.fish');
    });
    return this;
  }

  /**
   * Filters by file name (with or without .fish extension)
   */
  withName(name: string): Query {
    this._filters.push(doc => {
      const docPath = uriToPath(doc.uri);
      const basename = path.basename(docPath, '.fish');
      const basenameWithExt = path.basename(docPath);
      return basename === name || basenameWithExt === name;
    });
    return this;
  }

  /**
   * Filters by path patterns
   */
  withPath(...patterns: string[]): Query {
    this._filters.push(doc => {
      const docPath = uriToPath(doc.uri);
      return patterns.some(pattern => docPath.includes(pattern));
    });
    return this;
  }

  /**
   * Returns only the first match
   */
  firstMatch(): Query {
    this._returnFirst = true;
    return this;
  }

  /**
   * Executes the query against a list of documents
   */
  execute(documents: LspDocument[]): LspDocument[] {
    let result = documents;

    // Apply all filters
    for (const filter of this._filters) {
      result = result.filter(filter);
    }

    // Return first match if requested
    if (this._returnFirst) {
      return result.slice(0, 1);
    }

    return result;
  }
}

/**
 * Represents a test file with its content and path information
 */
export interface TestFileSpec {
  /** Relative path within the fish workspace (e.g., 'functions/foo.fish', 'config.fish') */
  relativePath: string;
  /** File content as string or array of lines */
  content: string | string[];
}

export namespace TestFileSpec {
  export function is(item: any): item is TestFileSpec {
    return item && typeof item.relativePath === 'string' && (typeof item.content === 'string' || Array.isArray(item.content));
  }
}

export interface TestFileSpecLegacy {
  path: string;
  text: string | string[];
}

export namespace TestFileSpecLegacy {
  export function is(item: any): item is TestFileSpecLegacy {
    return item && typeof item.path === 'string' && typeof item.text === 'string' && (typeof item.text === 'string' || Array.isArray(item.text));
  }

  export function toNewFormat(item: TestFileSpecLegacy): TestFileSpec {
    if (Array.isArray(item.text)) {
      return {
        relativePath: item.path,
        content: item.text.join('\n'),
      };
    }
    return {
      relativePath: item.path,
      content: item.text,
    };
  }
  // export function
}

export namespace TestFileSpecInput {
  export function is(item: any): item is TestFileSpecInput {
    return TestFileSpecLegacy.is(item) || item && typeof item.relativePath === 'string' && (typeof item.content === 'string' || Array.isArray(item.content));
  }
}

export type TestFileSpecInput = TestFileSpec | TestFileSpecLegacy;

/**
 * Configuration options for test workspace creation
 */
export interface TestWorkspaceConfig {
  /** Custom workspace name. If not provided, a unique name will be generated */
  name?: string;
  /** Base directory for test workspaces. Defaults to 'tests/workspaces' */
  baseDir?: string;
  /** Whether to enable debug logging for workspace operations */
  debug?: boolean;
  /** Whether to automatically analyze documents after creation */
  autoAnalyze?: boolean;
  /** Whether to prevent cleanup on inspect() calls */
  preserveOnInspect?: boolean;

  /** Whether to allow empty workspace folders (default: false) */
  forceAllDefaultWorkspaceFolders?: boolean;

  /** always backup snapshot after cleanup */
  writeSnapshotOnceSetup?: boolean;

  /** automatically focus the created workspace */
  autoFocusWorkspace?: boolean;

  /**
   * prefix created workspace paths with second outermost `fish` folder
   * (e.g., `tests/workspaces/<TEST_FOLDER>/fish/..`)
   */
  addEnclosingFishFolder?: boolean;
}

export interface ReadWorkspaceConfig {
  folderPath: string;
  debug?: boolean;
  includeEnclosingFishFolder?: boolean;
}
export namespace ReadWorkspaceConfig {
  export function is(item: any): item is ReadWorkspaceConfig {
    return item && typeof item.folderPath === 'string' && (item.debug === undefined || typeof item.debug === 'boolean') && (item.includeEnclosingFishFolder === undefined || typeof item.includeEnclosingFishFolder === 'boolean');
  }

  export function fromInput(input: string | ReadWorkspaceConfig): ReadWorkspaceConfig {
    if (typeof input === 'string') {
      return { folderPath: input, debug: false, includeEnclosingFishFolder: false };
    }
    return {
      folderPath: input.folderPath,
      debug: input.debug ?? false,
      includeEnclosingFishFolder: input.includeEnclosingFishFolder ?? false,
    };
  }
}

/**
 * Snapshot data for recreating workspaces
 */
export interface WorkspaceSnapshot {
  name: string;
  files: TestFileSpec[];
  timestamp: number;
}

/**
 * Helper class for creating different types of fish files
 */
export class TestFile {
  private constructor(
    public relativePath: string,
    public content: string | string[],
  ) { }

  /**
   * Creates a function file in the functions/ directory
   */
  static function(name: string, content: string | string[]) {
    const filename = name.endsWith('.fish') ? name : `${name}.fish`;
    return new TestFile(`functions/${filename}`, content);
  }

  /**
   * Creates a completion file in the completions/ directory
   */
  static completion(name: string, content: string | string[]) {
    const filename = name.endsWith('.fish') ? name : `${name}.fish`;
    return new TestFile(`completions/${filename}`, content);
  }

  /**
   * Creates a config.fish file
   */
  static config(content: string | string[]) {
    return new TestFile('config.fish', content);
  }

  /**
   * Creates a conf.d file
   */
  static confd(name: string, content: string | string[]) {
    const filename = name.endsWith('.fish') ? name : `${name}.fish`;
    return new TestFile(`conf.d/${filename}`, content);
  }

  /**
   * Creates a script file (non-autoloaded)
   */
  static script(name: string, content: string | string[]) {
    const filename = name.endsWith('.fish') ? name : `${name}.fish`;
    return new TestFile(`${filename}`, content);
  }

  /**
   * Creates a custom file at any relative path
   */
  static custom(relativePath: string, content: string | string[]) {
    return new TestFile(relativePath, content);
  }

  withShebang(shebang: string = '#!/usr/bin/env fish'): TestFile {
    // Add shebang to the content if it's a string
    const contentWithShebang = Array.isArray(this.content)
      ? [shebang, ...this.content]
      : `${shebang}\n${this.content}`;

    return new TestFile(this.relativePath, contentWithShebang);
  }

  static fromInput(relativePath: string, content: string | string[]): TestFile {
    if (relativePath === 'config.fish') {
      return TestFile.config(content);
    }
    switch (path.dirname(relativePath)) {
      case 'functions':
        return TestFile.function(path.basename(relativePath), content);
      case 'completions':
        return TestFile.completion(path.basename(relativePath), content);
      case 'conf.d':
        return TestFile.confd(path.basename(relativePath), content);
      case '.':
        if (path.basename(relativePath) === 'config.fish') {
          return TestFile.config(content);
        }
        return TestFile.script(path.basename(relativePath), content);
    }
    return new TestFile(relativePath, content);
  }
}

export let focusedWorkspace: Workspace | null = null;

/**
 * Main test workspace utility class
 */
export class TestWorkspace {
  private readonly _name: string;
  private readonly _basePath: string;
  private readonly _workspacePath: string;
  private readonly _config: Required<TestWorkspaceConfig>;
  private _files: TestFileSpec[] = [];
  private _documents: LspDocument[] = [];
  private _workspace: Workspace | null = null;
  private _isInitialized = false;
  private _isInspecting = false;
  // private _beforeAllSetup = false;
  // private _afterAllCleanup = false;
  private _focusedDocumentPath: string | null = null;

  private constructor(config: TestWorkspaceConfig = {}) {
    this._config = {
      name: config.name ?? this._generateUniqueName() + performance.now().toString().replace('.', ''),
      baseDir: config.baseDir || 'tests/workspaces',
      debug: config.debug ?? false,
      autoAnalyze: config.autoAnalyze ?? true,
      preserveOnInspect: config.preserveOnInspect ?? false,
      // Allow empty workspace folders by default
      forceAllDefaultWorkspaceFolders: config.forceAllDefaultWorkspaceFolders ?? false,
      writeSnapshotOnceSetup: config.writeSnapshotOnceSetup ?? false,
      autoFocusWorkspace: config.autoFocusWorkspace ?? true,
      addEnclosingFishFolder: config.addEnclosingFishFolder ?? false,
    };

    this._name = this._config.name;
    this._basePath = path.resolve(this._config.baseDir);
    this._workspacePath = path.join(this._basePath, this._name);
    if (SyncFileHelper.exists(this._workspacePath)) {
      this._name = this.name + this._generateUniqueName() + new Date().getMilliseconds().toString() + randomBytes(2).toString('hex');
      this._basePath = path.resolve(this._config.baseDir);
      this._workspacePath = path.join(this._basePath, this._name);
    }
    if (this._config.addEnclosingFishFolder) {
      this._workspacePath = path.join(this._workspacePath, 'fish');
    }

    if (this._config.debug) {
      logger.log(`TestWorkspace created: ${this._name} at ${this._workspacePath}`);
    }
  }

  static createBaseWorkspace() {
    return new TestWorkspace();
  }

  reset() {
    if (this._isInitialized) {
      for (const doc of this._documents) {
        const filePath = uriToPath(doc.uri);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          fs.rmSync(filePath, { recursive: true, force: true });
        }
      }
      for (const dir of ['functions', 'completions', 'conf.d']) {
        const dirPath = path.join(this._workspacePath, dir);
        if (fs.existsSync(dirPath)) {
          fs.rmdirSync(dirPath, { recursive: true });
        }
      }
    }
    if (!fs.existsSync(this._workspacePath)) {
      fs.mkdirSync(this._workspacePath, { recursive: true });
    }
    this._files = [];
    this._documents = [];
    this._workspace = null;
    this._isInitialized = false;
    this._isInspecting = false;
    this._focusedDocumentPath = null;
    return this;
  }

  /**
   * Generates a unique workspace from an existing test workspace directory
   *
   * `TestWorkspace` can be created using one of the following methods:
   *    - TestWorkspace.read(...)
   *    - TestWorkspace.create(...)
   *    - TestWorkspace.createSingle(...)
   *
   * @example
   * ```typescript
   * import { TestWorkspace } from './test-workspace-utils';
   *
   * describe('read workspace 1 from directory `workspace_1/fish`', () => {
   *
   *  const ws = TestWorkspace.read('workspace_1/fish')
   *    .initialize()
   *
   *  it('should read files from the specified directory', () => {
   *    const docs = ws.documents
   *    expect(docs.length).toBeGreaterThan(2);
   *  });
   *
   * });
   * ```
   *
   * Normally, you would need to chain `.setup()`/`.initialize()` after creation to
   * set up the workspace for testing.
   *
   * @param input Path to the workspace directory or configuration object
   * @returns A new TestWorkspace instance populated with files from the specified directory
   */
  static read(input: ReadWorkspaceConfig | string): TestWorkspace {
    const config: ReadWorkspaceConfig = ReadWorkspaceConfig.fromInput(input);

    const absPath = path.isAbsolute(config.folderPath)
      ? config.folderPath
      : fs.existsSync(path.join('tests', 'workspaces', config.folderPath))
        ? path.resolve(path.join('tests', 'workspaces', config.folderPath))
        : path.resolve(config.folderPath);

    let basePath = absPath;
    if (fs.existsSync(path.join(absPath, 'fish')) && fs.statSync(path.join(absPath, 'fish')).isDirectory()) {
      basePath = path.join(basePath, 'fish');
    }

    const workspace = new TestWorkspace({ debug: config.debug, addEnclosingFishFolder: config.includeEnclosingFishFolder });
    fastGlob.sync(['**/*.fish'], {
      cwd: absPath,
      absolute: true,
      onlyFiles: true,
    }).forEach(filePath => {
      let relPath = path.relative(absPath, filePath);
      if (basePath.endsWith('fish') && relPath.startsWith('fish/')) {
        relPath = relPath.substring(5);
      }
      const content = fs.readFileSync(filePath, 'utf8');
      workspace._files.push(TestFile.fromInput(relPath, content));
      if (config.debug) console.log(`Loaded file: ${relPath}`);
    });
    return workspace;
  }

  /**
   * Creates a new test workspace instance
   *
   * `TestWorkspace` can be created using one of the following methods:
   *    - TestWorkspace.read(...)
   *    - TestWorkspace.create(...)
   *    - TestWorkspace.createSingle(...)
   *
   * @example
   * ```typescript
   * describe('My Test', () => {
   *   const workspace = TestWorkspace.create({name: 'my_test_workspace'})
   *     .addFiles(TestFile.function('greet', 'function greet\n  echo "Hello, $argv[1]!"\nend'))
   *     .initialize();
   *
   *   it('should work', () => {
   *     const doc = workspace.focusedDocument;
   *     expect(doc?.getText()).toContain('function greet');
   *   });
   * });
   * ```
   *
   * Normally, you would need to chain `.setup()`/`.initialize()` after creation to
   * set up the workspace for testing.
   *
   * @param config Optional configuration for the workspace
   * @returns A new TestWorkspace instance
   */
  static create(config?: TestWorkspaceConfig): TestWorkspace {
    return new TestWorkspace(config);
  }

  /**
   * Creates a single file workspace with unified API - convenience method
   *
   * @example
   * ```typescript
   * describe('My Test', () => {
   *   const workspace = TestWorkspace.createSingle('function greet\n  echo "hello"\nend')
   *     .setup();
   *
   *   it('should work', () => {
   *     const doc = workspace.focusedDocument;
   *     expect(doc?.getText()).toContain('function greet');
   *   });
   * });
   * ```
   */
  static createSingle(
    content: string | string[] | TestFileSpecInput,
    type: 'function' | 'completion' | 'config' | 'confd' | 'script' | 'custom' = 'function',
    filename?: string,
  ): TestWorkspace {
    const name = filename || TestWorkspace._generateRandomName();
    const workspace = TestWorkspace.create({ name: `single_${name}` });

    // Create the appropriate file based on type
    let testFile: TestFile;
    if (TestFileSpecInput.is(content) && typeof content !== 'string' && !Array.isArray(content)) {
      if (TestFileSpecLegacy.is(content)) {
        const input = TestFileSpecLegacy.toNewFormat(content);
        testFile = TestFile.fromInput(input.relativePath, input.content);
      } else {
        testFile = TestFile.fromInput(content.relativePath, content.content);
      }
    } else {
      switch (type) {
        case 'function':
          testFile = TestFile.function(name, content);
          break;
        case 'completion':
          testFile = TestFile.completion(name, content);
          break;
        case 'config':
          testFile = TestFile.config(content);
          break;
        case 'confd':
          testFile = TestFile.confd(name, content);
          break;
        case 'script':
          testFile = TestFile.script(name, content);
          break;
        default:
          testFile = TestFile.custom(name, content);
          break;
      }
    }

    workspace.addFile(testFile);
    workspace._focusedDocumentPath = testFile.relativePath;
    return workspace;
  }

  static createSingleFileReady(
    content: string | string[] | TestFileSpecInput,
  ): { document: LspDocument; workspace: TestWorkspace; } {
    const workspace = new TestWorkspace({ name: `single_${TestWorkspace._generateRandomName()}` });

    if (typeof content === 'string' || Array.isArray(content)) {
      workspace.addFile(
        TestFile.confd('single_file.fish', content),
      );
    } else if (TestFileSpecLegacy.is(content)) {
      workspace.addFile(TestFileSpecLegacy.toNewFormat(content));
    } else {
      workspace.addFile(content);
    }

    // const workspace = TestWorkspace.createSingle(content)
    workspace.initialize();
    return {
      document: workspace.documents.at(0)!,
      workspace,
    };
  }

  /**
   * Creates a test workspace from a snapshot
   */
  static fromSnapshot(snapshotPath: string): TestWorkspace {
    const snapshotContent = fs.readFileSync(snapshotPath, 'utf8');
    const snapshot: WorkspaceSnapshot = JSON.parse(snapshotContent);

    const workspace = new TestWorkspace({ name: snapshot.name });
    workspace.addFiles(...snapshot.files);
    return workspace;
  }

  /**
   * Adds files to the workspace
   */
  addFiles(...files: TestFileSpecInput[]): TestWorkspace {
    for (const file of files) {
      if (TestFileSpecLegacy.is(file)) {
        if (this._files.some(f => f.relativePath === file.path)) {
          continue;
        }
        this._files.push(TestFileSpecLegacy.toNewFormat(file));
      } else {
        if (this._files.some(f => f.relativePath === file.relativePath)) {
          continue;
        }
        this._files.push(file);
      }
    }
    return this;
  }

  /**
   * Adds a single file to the workspace
   */
  addFile(file: TestFileSpecInput): TestWorkspace {
    const newFilePath = TestFileSpecLegacy.is(file) ? file.path : file.relativePath;
    if (this._files.some(f => f.relativePath === newFilePath)) {
      return this;
    }
    if (TestFileSpecLegacy.is(file)) {
      this._files.push(TestFileSpecLegacy.toNewFormat(file));
    } else {
      this._files.push(file);
    }
    return this;
  }

  /**
   * Inherits files from an existing autoloaded workspace directory
   */
  inheritFilesFromExistingAutoloadedWorkspace(sourcePath: string): TestWorkspace {
    if (sourcePath.startsWith('$')) {
      const stdout = execFileSync('fish', ['-c', `echo ${sourcePath}`]).toString().trim();
      if (stdout !== sourcePath && !fs.existsSync(sourcePath) && fs.existsSync(stdout)) {
        sourcePath = stdout;
      }
      if (!fs.existsSync(sourcePath)) {
        logger.error(`Source path does not exist: ${sourcePath}`);
        return this;
      }
    }

    if (SyncFileHelper.isExpandable(sourcePath) && !SyncFileHelper.isAbsolutePath(sourcePath)) {
      sourcePath = SyncFileHelper.expandEnvVars(sourcePath);
    }

    if (!fs.existsSync(sourcePath)) {
      if (this._config.debug) {
        logger.warning(`Source path does not exist: ${sourcePath}`);
      }
      return this;
    }

    const fishDirs = ['functions', 'completions', 'conf.d'];
    const configFile = 'config.fish';

    // Copy config.fish if it exists
    const configPath = path.join(sourcePath, configFile);
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      this.addFile(TestFile.config(content));
    }

    // Copy files from fish directories
    for (const dir of fishDirs) {
      const dirPath = path.join(sourcePath, dir);
      if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
        const files = fs.readdirSync(dirPath).filter(file => file.endsWith('.fish'));

        for (const file of files) {
          const filePath = path.join(dirPath, file);
          const content = fs.readFileSync(filePath, 'utf8');
          const relativePath = `${dir}/${file}`;
          this.addFile(TestFile.custom(relativePath, content));
        }
      }
    }

    if (this._config.debug) {
      logger.log(`Inherited files from: ${sourcePath}`);
    }

    return this;
  }

  /**
   * Edits a file in the workspace to simulate live editing
   */
  editFile(searchPath: string, newContent: string | string[]): void {
    if (!this._isInitialized) {
      throw new Error('Workspace must be initialized before editing files');
    }

    const doc = this.getDocument(searchPath);
    if (!doc) {
      throw new Error(`Document not found: ${searchPath}`);
    }

    const content = Array.isArray(newContent) ? newContent.join('\n') : newContent;
    const filePath = uriToPath(doc.uri);

    // Update file on disk
    fs.writeFileSync(filePath, content, 'utf8');

    // Update document in memory and trigger re-analysis
    documents.get(doc.uri)?.update([{ text: content }]);

    // Update our local document reference
    const docIndex = this._documents.findIndex(d => d.uri === doc.uri);
    if (docIndex !== -1) {
      const updatedDoc = documents.get(doc.uri) || LspDocument.createFromUri(doc.uri);
      this._documents[docIndex] = updatedDoc;

      if (this._config.autoAnalyze) {
        analyzer.analyze(updatedDoc);
      }
    }

    if (this._config.debug) {
      logger.log(`Edited file: ${searchPath}`);
    }
  }

  addDocuments(...item: (LspDocument | TestFileSpec)[]): TestWorkspace {
    for (const it of item) {
      this.addDocument(it);
    }
    return this;
  }

  addDocument(item: LspDocument | TestFileSpec): TestWorkspace {
    if (LspDocument.is(item)) {
      this._documents.push(item);
      this._files.push({
        relativePath: path.relative(this._workspacePath, uriToPath(item.uri)),
        content: item.getText(),
      });
      workspaceManager.current?.addPending(item.uri);
    } else {
      const fileSpec: TestFileSpec = {
        relativePath: item.relativePath,
        content: item.content,
      };
      SyncFileHelper.write(path.join(this._workspacePath, fileSpec.relativePath), Array.isArray(item.content) ? item.content.join('\n') : item.content);
      const doc = LspDocument.createFromPath(path.join(this._workspacePath, fileSpec.relativePath));
      this._files.push(fileSpec);
      workspaceManager.current?.addPending(doc.uri);
    }
    return this;
  }

  /**
   * Sets up the workspace - handles beforeAll() functionality
   */
  // initialize(): TestWorkspace {
  //   if (!this._beforeAllSetup) {
  //     beforeAll(async () => {
  //       await setupProcessEnvExecFile();
  //       if (!this._config.debug) logger.setSilent(true);
  //       await this._createWorkspaceFiles();
  //       await this._setupWorkspace();
  //       this._isInitialized = true;
  //     });
  //     this._beforeAllSetup = true;
  //     logger.setSilent(false);
  //   }
  //
  //   if (!this._afterAllCleanup) {
  //     afterAll(async () => {
  //       if (!this._isInspecting || !this._config.preserveOnInspect) {
  //         await this._cleanup();
  //       }
  //       testWorkspaces = [];
  //     });
  //     this._afterAllCleanup = true;
  //   }
  //
  //   beforeEach(async () => {
  //     if (!this._config.debug) logger.setSilent(true);
  //     workspaceManager.clear();
  //     await setupProcessEnvExecFile();
  //     await this._resetAnalysisState();
  //     await this._setupWorkspace();
  //     workspaceManager.setCurrent(this.getWorkspace()!);
  //     await workspaceManager.analyzePendingDocuments();
  //     logger.setSilent(false);
  //   });
  //
  //   afterEach(async () => {
  //     this._resetAnalysisState();
  //     workspaceManager.clear();
  //     await Analyzer.initialize();
  //   });
  //
  //   return this;
  // }
  //
  initialize() {
    this.setup();
    if (this._files.length === 1) {
      this.focus();
    }
    return this;
  }

  get setup() {
    return () => {
      beforeAll(async () => {
        await setupProcessEnvExecFile();
        await Analyzer.initialize();
        logger.setSilent();
        await this._createWorkspaceFiles();
        await this._setupWorkspace();
        this._isInitialized = true;
      });
      beforeEach(async () => {
        const wasSilentBefore = logger.isSilent();
        logger.setSilent(true);
        if (!this._isInitialized) {
          logger.setSilent(true);
          workspaceManager.clear();
          await setupProcessEnvExecFile();
          await this._resetAnalysisState();
          await this._setupWorkspace();
        }
        workspaceManager.setCurrent(this.getWorkspace()!);
        await workspaceManager.analyzePendingDocuments();
        // this._workspace = workspaceManager.current!;
        if (!this._config.debug && !wasSilentBefore) {
          logger.setSilent(false);
        }
        if (this._config.autoFocusWorkspace) {
          focusedWorkspace = this.getWorkspace();
          this._workspace = focusedWorkspace;
        }
        this._isInitialized = true;
      });
      afterEach(async () => {
        this._isInitialized = false;
      });
      afterAll(async () => {
        if (!this._isInspecting && !this._config.preserveOnInspect) {
          await this._cleanup();
          if (this._config.debug) {
            logger.log(`Cleaned up workspace: ${this._workspacePath}`);
          }
        }
      });
    };
  }

  /**
   * Sets the focused document path for single-file usage
   */
  focus(documentPath?: string | number): TestWorkspace {
    if (typeof documentPath === 'number') {
      this._focusedDocumentPath = this._files[documentPath]?.relativePath || null;
      return this;
    }
    if (!documentPath) {
      if (this._files.length === 1) {
        this._focusedDocumentPath = this._files[0]!.relativePath;
      } else {
        this._focusedDocumentPath = this._files[0] ? this._files[0]!.relativePath : null;
      }
    } else {
      this._focusedDocumentPath = documentPath;
    }
    return this;
  }

  /**
   * Setup with automatic focus on the single file (for single-file workspaces)
   */
  get setupWithFocus() {
    if (this._files.length === 1) {
      this._focusedDocumentPath = this._files[0]!.relativePath;
    }
    return this.setup;
  }

  /**
   * Gets all documents in the workspace
   */
  get documents(): LspDocument[] {
    return this._documents;
  }

  /**
   * Gets the focused document (for single-file workspaces)
   */
  get focusedDocument(): LspDocument | null {
    if (!this._focusedDocumentPath) return null;
    return this.getDocument(this._focusedDocumentPath) || null;
  }

  get document(): LspDocument | null {
    return this.focusedDocument || this.documents[0] || null;
  }

  get workspace(): Workspace | null {
    return this._workspace;
  }

  /**
   * Gets the workspace name
   */
  get name(): string {
    return this._name;
  }

  /**
   * Gets the workspace path
   */
  get path(): string {
    return this._workspacePath;
  }

  /**
   * Gets the workspace URI
   */
  get uri(): string {
    return pathToUri(this._workspacePath);
  }

  /**
   * Gets a document by its relative path or filename
   */
  getDocument(searchPath: string): LspDocument | undefined {
    return this._documents.find(doc => {
      const docPath = uriToPath(doc.uri);
      const relativePath = path.relative(this._workspacePath, docPath);

      // Try exact match first
      if (relativePath === searchPath) return true;

      // Try filename match
      if (path.basename(docPath) === searchPath) return true;

      // Try ending match (e.g., 'functions/foo.fish' matches 'foo.fish')
      if (relativePath.endsWith(searchPath)) return true;

      return false;
    });
  }

  /**
   * Gets documents using advanced query system
   */
  getDocuments(...queries: Query[]): LspDocument[] {
    if (queries.length === 0) {
      return [...this._documents];
    }

    // Combine all query results
    const allResults = new Set<string>();

    for (const query of queries) {
      const results = query.execute(this._documents);
      results.forEach(doc => allResults.add(doc.uri));
    }
    for (const uri of Array.from(allResults)) {
      if (allResults.has(uri) && !this._documents.some(doc => doc.uri === uri)) {
        allResults.delete(uri);
      }
    }

    const finalResults: LspDocument[] = [];
    for (const uri of Array.from(allResults)) {
      const found = this._documents.find(doc => {
        if (doc.uri === uri) {
          finalResults.push(doc);
          return true;
        }
      });
      if (found && !finalResults.map(d => d.uri).includes(found.uri)) {
        finalResults.push(found);
      }
    }

    return finalResults;
  }

  find(...query: (Query | string | number)[]) {
    if (query.length === 0) {
      return this.documents.at(0) || null;
    }
    if (query.length === 1) {
      const q = query[0];
      if (typeof q === 'string') {
        return this.documents.find(doc => doc.uri.endsWith(q)) || null;
      } else if (typeof q === 'number') {
        return this.documents.at(q) || null;
      } else {
        const results = q!.execute(this._documents);
        return results.at(0) || null;
      }
    }
    if (query.length > 1) {
      let results = this.getDocuments();
      for (const q of query) {
        if (typeof q === 'string') {
          results = results.filter(doc => {
            const docPath = uriToPath(doc.uri);
            const relativePath = path.relative(this._workspacePath, docPath);
            return relativePath === q || path.basename(docPath) === q || relativePath.endsWith(q);
          });
        } else if (typeof q === 'number') {
          results = results.slice(q, q + 1);
        } else {
          results = q!.execute(results);
        }
      }
      return results.at(0) || null;
    }
    return null;
  }

  /**
   * Gets the analyzed workspace instance
   */
  getWorkspace(): Workspace | null {
    return this._workspace;
  }

  /**
   * Converts this workspace to a TestWorkspaceResult for unified API
   */
  asResult() {
    const ws = this.getWorkspace();
    const docs = this.documents;
    const getDoc = (searchPath: string) => this.getDocument(searchPath);
    const getDocs = (...queries: Query[]) => this.getDocuments(...queries);

    return {
      workspace: ws,
      documents: docs,
      getDocument: getDoc,
      getDocuments: getDocs,
    };
  }

  /**
   * Prevents cleanup for inspection purposes
   */
  inspect(): TestWorkspace {
    this._isInspecting = true;
    return this;
  }

  /**
   * Dumps the file tree structure
   */
  dumpFileTree(): string {
    if (!fs.existsSync(this._workspacePath)) {
      return 'Workspace not created yet';
    }

    const tree: string[] = [];
    const buildTree = (dir: string, prefix = '') => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      entries.forEach((entry, index) => {
        const isLast = index === entries.length - 1;
        const currentPrefix = prefix + (isLast ? '└── ' : '├── ');
        tree.push(currentPrefix + entry.name);

        if (entry.isDirectory()) {
          const nextPrefix = prefix + (isLast ? '    ' : '│   ');
          buildTree(path.join(dir, entry.name), nextPrefix);
        }
      });
    };

    tree.push(this._name + '/');
    buildTree(this._workspacePath, '');
    return tree.join('\n');
  }

  /**
   * Creates a snapshot of the current workspace
   */
  writeSnapshot(outputPath?: string): string {
    const timestamp = Date.now();
    const snapshotPath = outputPath || path.join(this._basePath, `${this._name}.snapshot`);

    const snapshot: WorkspaceSnapshot = {
      name: this._name,
      files: this._files,
      timestamp,
    };

    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
    return snapshotPath;
  }

  // Private methods

  private _generateUniqueName(): string {
    const timestamp = Date.now().toString(36);
    const random = randomBytes(4).toString('hex');
    return `test_workspace_${timestamp}_${random}`;
  }

  private static _generateRandomName(): string {
    const timestamp = Date.now().toString(36);
    const random = randomBytes(3).toString('hex');
    return `test_${timestamp}_${random}`;
  }

  private async _createWorkspaceFiles(): Promise<void> {
    // Ensure workspace directory exists
    if (fs.existsSync(this._workspacePath)) {
      // Handle existing directory by adding suffix
      let counter = 1;
      let newName = `${this._name}_${counter}`;
      let newPath = path.join(this._basePath, newName);

      while (fs.existsSync(newPath)) {
        counter++;
        newName = `${this._name}_${counter}`;
        newPath = path.join(this._basePath, newName);
      }

      (this as any)._name = newName;
      (this as any)._workspacePath = newPath;

      if (this._config.debug) {
        logger.log(`Workspace directory exists, using: ${newName}`);
      }
    }

    fs.mkdirSync(this._workspacePath, { recursive: true });

    // Create fish directory structure
    if (this._config.forceAllDefaultWorkspaceFolders) {
      const fishDirs = ['functions', 'completions', 'conf.d'];
      fishDirs.forEach(dir => {
        const dirPath = path.join(this._workspacePath, dir);
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }
      });
    }

    // Write all files
    for (const file of this._files) {
      const filePath = path.join(this._workspacePath, file.relativePath);

      // Write file content
      const content = Array.isArray(file.content)
        ? file.content.join('\n')
        : file.content;

      SyncFileHelper.writeRecursive(filePath, content, 'utf8');

      if (this._config.debug) {
        logger.log(`Created file: ${file.relativePath}`);
      }
    }
    if (this._config.writeSnapshotOnceSetup) {
      this.writeSnapshot();
    }
  }

  private async _setupWorkspace(): Promise<void> {
    // Initialize analyzer if not already done
    if (!analyzer || !analyzer.started) {
      await Analyzer.initialize();
    }
    // const curr = documents.all()
    // workspaceManager.clear();

    // Create workspace instance
    this._workspace = Workspace.syncCreateFromUri(this.uri);
    if (!this._workspace) {
      throw new Error(`Failed to create workspace from ${this.uri}`);
    }
    // this._workspace.allUris.clear();
    // this._workspace.addPending(...Array.from(new Set(this._files.map(f => pathToUri(path.join(this._workspacePath, f.relativePath))))));
    // this._workspace!.name = this._name;

    // Add workspace to manager
    // workspaceManager.clear()

    // Create LspDocument instances for all files
    for (const file of Array.from(new Set(this._files))) {
      const filePath = path.join(this._workspacePath, file.relativePath);
      if (!fs.existsSync(filePath)) {
        SyncFileHelper.writeRecursive(filePath, Array.isArray(file.content) ? file.content.join('\n') : file.content, 'utf8');
      }
      const uri = pathToUri(filePath);
      const doc = LspDocument.createFromUri(uri);

      if (this._documents.some(d => d.uri === doc.uri)) {
        continue;
      }
      this._documents.push(doc);
      this._workspace.add(uri);

      if (this._config.autoAnalyze) {
        workspaceManager.handleOpenDocument(doc);
        analyzer.analyze(doc);
        testOpenDocument(doc);
      }
    }
    await workspaceManager.analyzePendingDocuments();
    workspaceManager.setCurrent(this._workspace);

    if (this._config.debug) {
      logger.log(`Workspace setup complete: ${this._documents.length} documents created`);
    }
  }

  async analyzeAllFiles() {
    logger.setSilent();
    if (!analyzer || !analyzer.started) {
      await Analyzer.initialize();
    }

    // Create workspace instance
    this._workspace = Workspace.syncCreateFromUri(this.uri);
    if (!this._workspace) {
      throw new Error(`Failed to create workspace from ${this.uri}`);
    }
    this._workspace!.name = this._name;

    // Add workspace to manager
    workspaceManager.add(this._workspace);
    workspaceManager.setCurrent(this._workspace);

    // Create LspDocument instances for all files
    for (const file of this._files) {
      const filePath = path.join(this._workspacePath, file.relativePath);
      SyncFileHelper.writeRecursive(filePath, Array.isArray(file.content) ? file.content.join('\n') : file.content, 'utf8');
      const uri = pathToUri(filePath);
      const doc = LspDocument.createFromUri(uri);

      this._documents.push(doc);
      this._workspace.add(uri);

      if (this._config.autoAnalyze) {
        testOpenDocument(doc);
        workspaceManager.handleOpenDocument(doc);
        analyzer.analyze(doc);
        // workspaceManager.current?.addUri(doc.uri);
      }
    }
    await workspaceManager.analyzePendingDocuments();
    workspaceManager.setCurrent(this._workspace);
    logger.setSilent(false);
  }

  private async _resetAnalysisState(): Promise<void> {
    // Clear global documents state but don't remove files from disk
    testClearDocuments();

    // Re-add our documents if needed
    if (this._config.autoAnalyze) {
      for (const doc of this._files) {
        const filePath = path.join(this._workspacePath, doc.relativePath);
        const uri = pathToUri(filePath);
        const lspDoc = LspDocument.createFromUri(uri);
        workspaceManager.handleOpenDocument(lspDoc);
        analyzer.analyze(lspDoc);
        testOpenDocument(lspDoc);
      }
    }
  }

  private async _cleanup(): Promise<void> {
    try {
      // Clear documents state
      testClearDocuments();

      // Remove workspace from manager
      if (this._workspace) {
        workspaceManager.remove(this._workspace);
      }

      // Remove files from disk
      // For workspaces with addEnclosingFishFolder, we need to remove the parent directory
      const cleanupPath = this._config.addEnclosingFishFolder
        ? path.dirname(this._workspacePath)
        : this._workspacePath;

      if (fs.existsSync(cleanupPath)) {
        fs.rmSync(cleanupPath, { recursive: true, force: true });

        if (this._config.debug) {
          logger.log(`Cleaned up workspace: ${cleanupPath}`);
        }
      }
    } catch (error) {
      if (this._config.debug) {
        logger.error(`Error during cleanup: ${error}`);
      }
    }
  }
}

/**
 * Utility functions for controlling logger behavior during tests
 */
export class TestLogger {
  private static _previousLogLevel: any = null;

  /**
   * Disables logging output for cleaner test output
   */
  static setSilent(silent: boolean): void {
    if (silent) {
      if (TestLogger._previousLogLevel === null) {
        // Store current log configuration if not already stored
        TestLogger._previousLogLevel = {
          // Add any logger state you want to preserve
        };
      }
      // Disable logging (implementation depends on your logger)
      // logger.setLevel('silent') or similar
    } else {
      // Restore previous logging state
      if (TestLogger._previousLogLevel !== null) {
        // Restore logger configuration
        TestLogger._previousLogLevel = null;
      }
    }
  }

  /**
   * Enables debug logging for test workspace operations
   */
  static enableTestWorkspaceLogging(): void {
    // Enable debug logging specifically for test workspace operations
    TestLogger.setSilent(false);
  }
}

/**
 * Predefined test workspaces for common testing scenarios
 */
export class DefaultTestWorkspaces {
  static emptyWorkspace(): TestWorkspace {
    return TestWorkspace.create({ name: `empty_workspace_${now().replace(' ', '_')}` }).reset();
  }

  /**
   * Creates a basic fish function workspace
   */
  static basicFunctions(): TestWorkspace {
    return TestWorkspace.create({ name: 'basic_functions' })
      .addFiles(
        TestFile.function('greet', `
function greet
    echo "Hello, $argv[1]!"
end`),
        TestFile.function('add', `
function add
    math $argv[1] + $argv[2]
end`),
        TestFile.completion('greet', `
complete -c greet -a "(ls)"
complete -c greet -l help -d "Show help"`),
      );
  }

  /**
   * Creates a workspace with complex function interactions
   */
  static complexFunctions(): TestWorkspace {
    return TestWorkspace.create({ name: 'complex_functions' })
      .addFiles(
        TestFile.function('main', `
function main
    set -l result (helper_func $argv)
    process_result $result
end`),
        TestFile.function('helper_func', `
function helper_func
    echo "Processing: $argv"
end`),
        TestFile.function('process_result', `
function process_result
    if test -n "$argv[1]"
        echo "Result: $argv[1]"
    else
        echo "No result"
    end
end`),
        TestFile.config(`
set -g my_global_var "default_value"
source (dirname (status --current-filename))/functions/main.fish`),
      );
  }

  /**
   * Creates a workspace with configuration and event handlers
   */
  static configAndEvents(): TestWorkspace {
    return TestWorkspace.create({ name: 'config_and_events' })
      .addFiles(
        TestFile.config(`
set -g fish_greeting "Welcome to test workspace!"
set -gx PATH $PATH /usr/local/test/bin`),
        TestFile.confd('setup', `
function setup_test_env --on-event fish_prompt
    if not set -q test_env_loaded
        set -g test_env_loaded true
        echo "Test environment loaded"
    end
end`),
        TestFile.confd('cleanup', `
function cleanup_test_env --on-event fish_exit
    echo "Cleaning up test environment"
end`),
      );
  }

  /**
   * Creates a workspace that simulates a real project structure
   */
  static projectWorkspace(): TestWorkspace {
    return TestWorkspace.create({ name: 'project_workspace' })
      .addFiles(
        // Main project functions
        TestFile.function('build', `
function build
    echo "Building project..."
    if test -f Makefile
        make
    else if test -f package.json
        npm run build
    else
        echo "No build system found"
        return 1
    end
end`),
        TestFile.function('test', `
function test
    echo "Running tests..."
    if test -f package.json
        npm test
    else if test -f Cargo.toml
        cargo test
    else
        echo "No test framework found"
        return 1
    end
end`),
        TestFile.function('deploy', `
function deploy
    build
    if test $status -eq 0
        echo "Deploying..."
        # Deployment logic here
    else
        echo "Build failed, cannot deploy"
        return 1
    end
end`),
        // Project completions
        TestFile.completion('build', `
complete -c build -l verbose -d "Enable verbose output"
complete -c build -l clean -d "Clean before building"`),
        TestFile.completion('deploy', `
complete -c deploy -l staging -d "Deploy to staging"
complete -c deploy -l production -d "Deploy to production"`),
        // Project configuration
        TestFile.config(`
# Project-specific configuration
set -gx PROJECT_ROOT (dirname (status --current-filename))
set -gx PROJECT_NAME "fish-test-project"

# Add project bin to PATH
set -gx PATH $PROJECT_ROOT/bin $PATH`),
        // Scripts (non-autoloaded)
        TestFile.script('install', `#!/usr/bin/env fish
# Installation script for the project

echo "Installing project dependencies..."
if test -f package.json
    npm install
else if test -f Cargo.toml
    cargo build
end

echo "Project installed successfully!"`),
      );
  }
}

export function cliModule() {
  const program = new Command()
    .name('test-workspace-utils')
    .description('Utility to create and manage test workspaces for fish-language-server')
    .version('1.0.0')
    .option('-n, --name <name>', 'Name of the workspace to create')
    .option('-i, --input <path>', 'Path to the workspace directory to read')
    .option('--show-tree', 'Show the file tree of the created workspace')
    .option('--show-tree-sitter-ast', 'Show the Tree-sitter AST of all documents in workspace')
    .option('--save-snapshot', 'Save a snapshot of the created workspace')
    .option('--convert-snapshot-to-workspace', 'Convert a snapshot file back to a workspace directory')
    .option('-h, --help', 'Show help message');
  program.parse();
  const options = program.opts();
  if (options.help) {
    program.outputHelp();
    process.exit(0);
  }
  let workspace: TestWorkspace | null = null;
  let wsPath = '';
  const inputIsSnapshot = options.input && options.input.endsWith('.snapshot');

  if (options.name) {
    wsPath = fastGlob.globSync([`${options.name}*.snapshot`, `${options.name}*`], { cwd: path.resolve('./tests/workspaces'), deep: 1 })[0] || '';
  } else if (options.input) {
    wsPath = path.resolve(options.input);
  } else {
    console.error('Error: You must specify either a workspace name or an input path.');
    program.outputHelp();
    process.exit(1);
  }
  if (wsPath.endsWith('.snapshot') || inputIsSnapshot) {
    workspace = TestWorkspace.fromSnapshot(wsPath);
    workspace.inspect();
    if (options.convertSnapshotToWorkspace) {
      workspace.initialize();
      console.log(`Converted snapshot to workspace at: ${workspace.path}`);
      process.exit(0);
    }
  } else if (fs.existsSync(wsPath) && fs.statSync(wsPath).isDirectory()) {
    workspace = TestWorkspace.read(wsPath);
  }

  if (!workspace) {
    console.error('Error: Failed to create workspace. Check the provided name or input path.');
    process.exit(1);
  }
  workspace.inspect().initialize();
  if (options.showTree) {
    console.log(`Workspace path: ${workspace.path}`);
    console.log(workspace.dumpFileTree());
  }
  if (options.saveSnapshot) {
    const snapshotPath = workspace.writeSnapshot();
    console.log(`Snapshot saved to: ${snapshotPath}`);
  }

  if (options.showTreeSitterAst) {
    workspace.documents.forEach((doc, idx) => {
      const tree = doc.getTree();
      if (idx === 1) console.log('----------------------------------------');
      console.log(`Document: ${path.relative(workspace.path, uriToPath(doc.uri))}`);
      console.log(tree);
      console.log('----------------------------------------');
    });
  }
}

// Convenience export for the main class
export { TestWorkspace as default };
