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
 *     );
 *
 *   workspace.initialize(); // Handles beforeAll/afterAll automatically
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
import { logger } from '../src/logger';
import { SyncFileHelper } from '../src/utils/file-operations';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { execFileSync, execSync } from 'child_process';

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
}

/**
 * Common interface for test workspace results with consistent API
 */
export interface TestWorkspaceResult {
  /** The test workspace containing the document(s) */
  workspace: TestWorkspace;
  /** Gets all documents in the workspace */
  documents: LspDocument[];
  /** Get a document by search path */
  getDocument(searchPath: string): LspDocument | undefined;
  /** Get documents using query system */
  getDocuments(...queries: Query[]): LspDocument[];
}

/**
 * Result from creating a single file test workspace
 */
export interface SingleFileTestResult extends TestWorkspaceResult {
  /** The created LspDocument - guaranteed to exist */
  document: LspDocument;
  /** The file path relative to workspace root */
  relativePath: string;
  /** The absolute file path */
  absolutePath: string;
  /** The document URI */
  uri: string;
}

/**
 * Options for creating a single file test workspace
 */
export interface SingleFileTestOptions {
  /** Custom filename (without .fish extension). If not provided, generates random name */
  filename?: string;
  /** File type. Defaults to 'function' */
  type?: 'function' | 'completion' | 'config' | 'confd' | 'script';
  /** Custom workspace name. If not provided, generates random name */
  workspaceName?: string;
  /** Whether to enable debug logging */
  debug?: boolean;
  /** Whether to automatically analyze the document */
  autoAnalyze?: boolean;
}

export let testWorkspaces: TestWorkspace[] = [];

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
  private _beforeAllSetup = false;
  private _afterAllCleanup = false;

  private constructor(config: TestWorkspaceConfig = {}) {
    this._config = {
      name: config.name || this._generateUniqueName(),
      baseDir: config.baseDir || 'tests/workspaces',
      debug: config.debug ?? false,
      autoAnalyze: config.autoAnalyze ?? true,
      preserveOnInspect: config.preserveOnInspect ?? false,
    };

    this._name = this._config.name;
    this._basePath = path.resolve(this._config.baseDir);
    this._workspacePath = path.join(this._basePath, this._name);

    if (this._config.debug) {
      logger.log(`TestWorkspace created: ${this._name} at ${this._workspacePath}`);
    }
    this.addTestWorkspace();
  }

  addTestWorkspace(): TestWorkspace {
    testWorkspaces.push(this);
    return this;
  }

  /**
   * Creates a new test workspace instance
   */
  static create(config?: TestWorkspaceConfig): TestWorkspace {
    return new TestWorkspace(config);
  }

  /**
   * Creates a single file test workspace for simple testing scenarios
   *
   * @example Basic usage
   * ```typescript
   * describe('My Test', () => {
   *   const { document, workspace } = TestWorkspace.createSingleFile('function greet\n  echo "hello"\nend');
   *   workspace.initialize();
   *
   *   it('should work', () => {
   *     expect(document.getText()).toContain('function greet');
   *   });
   * });
   * ```
   *
   * @example With options
   * ```typescript
   * const result = TestWorkspace.createSingleFile('complete -c foo -l help', {
   *   type: 'completion',
   *   filename: 'foo',
   *   debug: true
   * });
   * ```
   */
  static createSingleFile(
    content: string | string[],
    options: SingleFileTestOptions = {},
  ): SingleFileTestResult {
    const {
      filename = TestWorkspace._generateRandomName(),
      type = 'function',
      workspaceName = `single_file_${TestWorkspace._generateRandomName()}`,
      debug = false,
      autoAnalyze = true,
    } = options;

    // Create the workspace
    const workspace = new TestWorkspace({
      name: workspaceName,
      debug,
      autoAnalyze,
    });

    // Create the appropriate file based on type
    let testFile: TestFile;
    switch (type) {
      case 'function':
        testFile = TestFile.function(filename, content);
        break;
      case 'completion':
        testFile = TestFile.completion(filename, content);
        break;
      case 'config':
        testFile = TestFile.config(content);
        break;
      case 'confd':
        testFile = TestFile.confd(filename, content);
        break;
      case 'script':
        testFile = TestFile.script(filename, content);
        break;
      default:
        throw new Error(`Unknown file type: ${type}`);
    }

    workspace.addFile(testFile);

    // Calculate paths
    const workspacePath = workspace._workspacePath;
    const absoluteFilePath = path.join(workspacePath, testFile.relativePath);
    const absolutePath = path.resolve(absoluteFilePath);
    const uri = pathToUri(absolutePath);

    // Store the relative path for the closure to avoid reference issues
    const relativeFilePath = testFile.relativePath;

    // Create a proxy object that provides lazy access to the document
    const result: SingleFileTestResult = {
      get document(): LspDocument {
        const doc = workspace.getDocument(relativeFilePath);
        if (!doc) {
          throw new Error(`Document not found: ${relativeFilePath}. Make sure to call workspace.initialize() first.`);
        }
        return doc;
      },
      workspace,
      get documents(): LspDocument[] {
        return workspace.documents;
      },
      getDocument: (searchPath: string) => workspace.getDocument(searchPath),
      getDocuments: (...queries: Query[]) => workspace.getDocuments(...queries),
      relativePath: relativeFilePath,
      absolutePath,
      uri,
    };

    return result;
  }

  /**
   * Alternative static method that immediately initializes and returns a ready-to-use result
   */
  static async createSingleFileReady(
    content: string | string[],
    options: SingleFileTestOptions = {},
  ): Promise<SingleFileTestResult> {
    const {
      filename = TestWorkspace._generateRandomName(),
      type = 'function',
      workspaceName = `single_file_${TestWorkspace._generateRandomName()}`,
      debug = false,
      autoAnalyze = true,
    } = options;

    // Create the workspace
    const workspace = new TestWorkspace({
      name: workspaceName,
      debug,
      autoAnalyze,
    });

    // Create the appropriate file based on type
    let testFile: TestFile;
    switch (type) {
      case 'function':
        testFile = TestFile.function(filename, content);
        break;
      case 'completion':
        testFile = TestFile.completion(filename, content);
        break;
      case 'config':
        testFile = TestFile.config(content);
        break;
      case 'confd':
        testFile = TestFile.confd(filename, content);
        break;
      case 'script':
        testFile = TestFile.script(filename, content);
        break;
      default:
        throw new Error(`Unknown file type: ${type}`);
    }

    workspace.addFile(testFile);

    // Initialize the workspace manually
    await workspace._createWorkspaceFiles();
    await workspace._setupWorkspace();
    workspace._isInitialized = true;

    // Get the actual document
    const document = workspace.getDocument(testFile.relativePath);
    if (!document) {
      throw new Error(`Failed to create document for ${testFile.relativePath}`);
    }

    // Calculate paths
    const workspacePath = workspace._workspacePath;
    const filePath = path.join(workspacePath, testFile.relativePath);
    const absolutePath = path.resolve(filePath);
    const uri = pathToUri(absolutePath);

    return {
      document,
      workspace,
      documents: workspace.documents,
      getDocument: (searchPath: string) => workspace.getDocument(searchPath),
      getDocuments: (...queries: Query[]) => workspace.getDocuments(...queries),
      relativePath: testFile.relativePath,
      absolutePath,
      uri,
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
  addFiles(...files: TestFileSpec[]): TestWorkspace {
    this._files.push(...files);
    return this;
  }

  /**
   * Adds a single file to the workspace
   */
  addFile(file: TestFileSpec): TestWorkspace {
    this._files.push(file);
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
    documents.applyChanges(doc.uri, [{ text: content }]);

    // Update our local document reference
    const docIndex = this._documents.findIndex(d => d.uri === doc.uri);
    if (docIndex !== -1) {
      const updatedDoc = documents.getDocument(doc.uri) || LspDocument.createFromUri(doc.uri);
      this._documents[docIndex] = updatedDoc;

      if (this._config.autoAnalyze) {
        analyzer.analyze(updatedDoc);
      }
    }

    if (this._config.debug) {
      logger.log(`Edited file: ${searchPath}`);
    }
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
      const doc = LspDocument.create(path.join(this._workspacePath, fileSpec.relativePath));
      this._files.push(fileSpec);
      workspaceManager.current?.addPending(doc.uri);
    }
    return this;
  }

  /**
   * Sets up the workspace - handles beforeAll() functionality
   */
  initialize(): TestWorkspace {
    if (!this._beforeAllSetup) {
      beforeAll(async () => {
        await setupProcessEnvExecFile();
        if (!this._config.debug) logger.setSilent(true);
        await this._createWorkspaceFiles();
        await this._setupWorkspace();
        this._isInitialized = true;
      });
      this._beforeAllSetup = true;
      logger.setSilent(false);
    }

    if (!this._afterAllCleanup) {
      afterAll(async () => {
        if (!this._isInspecting || !this._config.preserveOnInspect) {
          await this._cleanup();
        }
        testWorkspaces = [];
      });
      this._afterAllCleanup = true;
    }

    beforeEach(async () => {
      if (!this._config.debug) logger.setSilent(true);
      workspaceManager.clear();
      await setupProcessEnvExecFile();
      await this._resetAnalysisState();
      workspaceManager.setCurrent(this.getWorkspace()!);
      await workspaceManager.analyzePendingDocuments();
      logger.setSilent(false);
    });

    afterEach(async () => {
      this._resetAnalysisState();
      workspaceManager.clear();
      await Analyzer.initialize();
    });

    return this;
  }

  static allTestWorkspaces(): TestWorkspace[] {
    return [...testWorkspaces];
  }

  /**
   * Gets all documents in the workspace
   */
  get documents(): LspDocument[] {
    return [...this._documents];
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
    const allResults = new Set<LspDocument>();

    for (const query of queries) {
      const results = query.execute(this._documents);
      results.forEach(doc => allResults.add(doc));
    }

    return Array.from(allResults);
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
  asResult(): TestWorkspaceResult {
    return {
      workspace: this,
      documents: this.documents,
      getDocument: (searchPath: string) => this.getDocument(searchPath),
      getDocuments: (...queries: Query[]) => this.getDocuments(...queries),
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
    const fishDirs = ['functions', 'completions', 'conf.d', 'scripts'];
    fishDirs.forEach(dir => {
      fs.mkdirSync(path.join(this._workspacePath, dir), { recursive: true });
    });

    // Write all files
    for (const file of this._files) {
      const filePath = path.join(this._workspacePath, file.relativePath);
      const dir = path.dirname(filePath);

      // Ensure directory exists
      fs.mkdirSync(dir, { recursive: true });

      // Write file content
      const content = Array.isArray(file.content)
        ? file.content.join('\n')
        : file.content;

      fs.writeFileSync(filePath, content, 'utf8');

      if (this._config.debug) {
        logger.log(`Created file: ${file.relativePath}`);
      }
    }
  }

  private async _setupWorkspace(): Promise<void> {
    // Initialize analyzer if not already done
    if (!analyzer || !analyzer.started) {
      await Analyzer.initialize();
    }

    // Create workspace instance
    this._workspace = Workspace.syncCreateFromUri(this.uri);
    if (!this._workspace) {
      throw new Error(`Failed to create workspace from ${this.uri}`);
    }

    // Add workspace to manager
    workspaceManager.add(this._workspace);

    // Create LspDocument instances for all files
    for (const file of this._files) {
      const filePath = path.join(this._workspacePath, file.relativePath);
      const uri = pathToUri(filePath);
      const doc = LspDocument.createFromUri(uri);

      this._documents.push(doc);
      this._workspace.add(uri);

      if (this._config.autoAnalyze) {
        analyzer.analyze(doc);
      }
    }
    workspaceManager.setCurrent(this._workspace);

    if (this._config.debug) {
      logger.log(`Workspace setup complete: ${this._documents.length} documents created`);
    }
  }

  private async _resetAnalysisState(): Promise<void> {
    // Clear global documents state but don't remove files from disk
    documents.clear();

    // Re-add our documents if needed
    if (this._config.autoAnalyze) {
      for (const doc of this._documents) {
        documents.open(doc);
      }
    }
  }

  private async _cleanup(): Promise<void> {
    try {
      // Clear documents state
      documents.clear();

      // Remove workspace from manager
      if (this._workspace) {
        workspaceManager.remove(this._workspace);
      }

      // Remove files from disk
      if (fs.existsSync(this._workspacePath)) {
        fs.rmSync(this._workspacePath, { recursive: true, force: true });

        if (this._config.debug) {
          logger.log(`Cleaned up workspace: ${this._workspacePath}`);
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

// Convenience export for the main class
export { TestWorkspace as default };
