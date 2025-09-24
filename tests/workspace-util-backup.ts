import fs from 'fs';
import * as path from 'path';
import { documents, LspDocument } from '../src/document';
import FastGlob from 'fast-glob';
import { randomBytes } from 'crypto';
import { Analyzer } from '../src/analyze';
import { workspaceManager } from '../src/utils/workspace-manager';
import { Workspace } from '../src/utils/workspace';
import { pathToUri, uriToPath } from '../src/utils/translation';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { logger } from '../src/logger';
import { execFileSync } from 'child_process';
import { SyncFileHelper } from '../src/utils/file-operations';

function generateRandomWorkspaceName(): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(3).toString('hex');
  return `test_workspace_${timestamp}_${random}`;
}

type TestFileType = 'function' | 'config' | 'completion' | 'conf.d' | 'autoloaded' | 'script';

export type QueryPathType = 'functions' | 'completions' | 'conf.d' | 'config.fish' | 'autoloaded' | 'scripts' | 'any';
export class QueryConfig {
  public nameMatch?: string | RegExp;
  public pathMatch?: string | RegExp;
  public onlyMatchesPathType?: QueryPathType[];
  public allMatchesPathType?: QueryPathType[];

  static is(config: any): config is QueryConfig {
    if (!config || typeof config !== 'object' || Array.isArray(config) || LspDocument.is(config) || typeof config === 'string') {
      return false;
    }
    return (
      typeof config === 'object' &&
      (config.nameMatch !== undefined && typeof config.nameMatch === 'string' || config.nameMatch instanceof RegExp) ||
      (config.pathMatch !== undefined && typeof config.pathMatch === 'string' || config.pathMatch instanceof RegExp) ||
      config.onlyMatchesPathType !== undefined && Array.isArray(config.onlyMatchesPathType) ||
      config.allMatchesPathType !== undefined && Array.isArray(config.allMatchesPathType)
    );
  }

  static to(config: QueryConfig): Query {
    if (!QueryConfig.is(config)) {
      throw new Error('Invalid QueryConfig');
    }

    let query = Query.create();

    if (config.nameMatch) {
      query = query.withName(config.nameMatch.toString());
    }

    if (config.pathMatch) {
      query = query.withPath(config.pathMatch.toString());
    }

    if (config.onlyMatchesPathType) {
      for (const type of config.onlyMatchesPathType) {
        switch (type) {
          case 'functions':
            query = query.functions();
            break;
          case 'completions':
            query = query.completions();
            break;
          case 'conf.d':
            query = query.confd();
            break;
          case 'config.fish':
            query = query.config();
            break;
          case 'autoloaded':
            query = query.autoloaded();
            break;
          case 'scripts':
            query = query.scripts();
            break;
          case 'any':
            query = query.autoloaded()
              .scripts()
              .functions()
              .completions()
              .confd()
              .config();
            // No specific filter, matches all
            break;
        }
      }
    }

    return query;
  }
}

/**
 * Query builder for advanced document selection
 */
export class Query {
  private _filters: ((doc: LspDocument) => boolean)[] = [];
  private _returnFirst = false;

  private constructor() { }

  public static is(query: unknown): query is Query {
    if (!query || typeof query !== 'object') {
      return false;
    }
    return (
      query instanceof Query &&
      query._filters !== undefined &&
      query._filters instanceof Array &&
      query._filters.every(filter => typeof filter === 'function') &&
      query._returnFirst !== undefined
    );
  }

  public static fromConfig(config: QueryConfig | string | unknown): Query {
    if (typeof config === 'string') {
      // If it's a string, treat it as a name match
      return Query.create().withName(config) ||
        Query.create().withPath(config);
    }
    if (QueryConfig.is(config)) {
      return QueryConfig.to(config);
    }
    return new Query();
  }

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
      const basename = path.basename(doc.path, '.fish');
      const basenameWithExt = path.basename(doc.path);
      return basename === name || basenameWithExt === name || doc.getFileName().includes(name);
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
// Consolidated TestFileSpec (removing duplication)
export class TestFileSpec {
  private absPath: string;
  private _content: string;
  private _focused: boolean = false;
  private _created: boolean = false;
  private static rootDirPath = path.resolve('tests/workspaces');

  constructor(
    public name: string,
    content: string | string[] = '',
    _type: TestFileType = 'script',
    _baseDir: string = generateRandomWorkspaceName(),
  ) {
    // Normalize file extension and path
    const normalizedName = this._normalizeName(name, _type);
    this.absPath = path.join(TestFileSpec.rootDirPath, _baseDir, normalizedName);
    this._content = Array.isArray(content) ? content.join('\n') : content;
  }

  private _normalizeName(name: string, type: TestFileType): string {
    // Add .fish extension if needed (except for scripts)
    if (!name.endsWith('.fish') && type !== 'script') {
      name = `${name}.fish`;
    }

    // Add directory prefix based on type
    switch (type) {
      case 'function':
      case 'completion':
      case 'conf.d':
      case 'autoloaded':
        return `${type}/${name}`;
      case 'config':
        return 'config.fish';
      default:
        return name;
    }
  }

  writeFile() {
    if (this._created) {
      return;
    }
    const dir = path.dirname(this.absPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.absPath, this._content);
    this._created = true;
  }

  get path(): string {
    if (!this._created) {
      this.writeFile();
    }
    return this.absPath;
  }

  toDocument(): LspDocument {
    if (!this._created) {
      this.writeFile();
    }
    return LspDocument.createFromPath(this.absPath);
  }

  addShebang(bang: string = '#!/usr/bin/env fish') {
    if (!this._content.startsWith(bang)) {
      this._content = `${bang}\n${this._content}`;
    }
    return this;
  }

  get focused(): boolean {
    return this._focused;
  }

  focus() {
    this._focused = true;
    return this;
  }

  static createFunction(
    name: string,
    content: string | string[] = '',
    baseDir: string = path.resolve('tests/workspaces'),
  ): TestFileSpec {
    return new TestFileSpec(name, content, 'function', baseDir);
  }

  static createConfig(
    content: string | string[] = '',
    baseDir: string = path.resolve('tests/workspaces'),
  ): TestFileSpec {
    return new TestFileSpec('config.fish', content, 'config', baseDir);
  }

  static createCompletion(
    name: string,
    content: string | string[] = '',
    baseDir: string = path.resolve('tests/workspaces'),
  ): TestFileSpec {
    return new TestFileSpec(name, content, 'completion', baseDir);
  }

  static createConfd(
    name: string,
    content: string | string[] = '',
    baseDir: string = path.resolve('tests/workspaces'),
  ): TestFileSpec {
    return new TestFileSpec(name, content, 'conf.d', baseDir);
  }

  static createScript(
    name: string,
    content: string | string[] = '',
    baseDir: string = path.resolve('tests/workspaces'),
  ): TestFileSpec {
    return new TestFileSpec(name, content, 'script', baseDir);
  }

  static createFromAutoloaded(
    folderpath: string,
    baseDir: string = path.join(path.resolve('tests/workspaces')),
  ) {
    const copiedFiles: TestFileSpec[] = [];
    const files = FastGlob.globSync('**/*.fish', {
      absolute: true,
      cwd: path.resolve(folderpath),
      onlyFiles: true,
      globstar: true,
    });
    for (const file of files) {
      let autoloadedType = '';
      if (['config.fish', 'functions', 'completions', 'conf.d'].includes(file)) {
        if (file === 'config.fish') {
          autoloadedType = 'config';
        } else {
          autoloadedType = path.basename(path.dirname(file));
        }
      }
      const fileName = path.basename(file);
      const content = fs.readFileSync(file, 'utf8');
      switch (autoloadedType) {
        case 'config':
          copiedFiles.push(TestFileSpec.createConfig(content, baseDir));
          break;
        case 'functions':
          copiedFiles.push(TestFileSpec.createFunction(fileName, content, baseDir));
          break;
        case 'completions':
          copiedFiles.push(TestFileSpec.createCompletion(fileName, content, baseDir));
          break;
        case 'conf.d':
          copiedFiles.push(TestFileSpec.createConfd(fileName, content, baseDir));
          break;
        default:
          copiedFiles.push(TestFileSpec.createScript(fileName, content, baseDir));
          break;
      }
    }
    return copiedFiles;
  }

  static create(
    name: string,
    content: string | string[] = '',
    type: 'function' | 'config' | 'completion' | 'conf.d' | 'autoloaded' | 'script' | '' = '',
    baseDir: string = generateRandomWorkspaceName(),
  ): TestFileSpec {
    if (type.trim() === '') {
      switch (true) {
        case name.includes('/config.fish'):
          type = 'config';
          break;
        case name.includes('/completions/'):
          type = 'completion';
          break;
        case name.includes('/conf.d/'):
          type = 'conf.d';
          break;
        case name.includes('/functions/'):
          type = 'function';
          break;
        default:
          type = 'script';
          break;
      }
    }
    const result = new TestFileSpec(name, content, type as TestFileType, baseDir);
    result.writeFile();
    return result;
  }
}

// Simplified TestFile class (removing BaseTestFile duplication)
export class TestFile {
  private hasWritten = false;
  public static baseDir = path.resolve('tests/workspaces');

  private constructor(
    public relativePath: string,
    public content: string | string[],
    public rootPath: string = TestFile.baseDir,
  ) { }

  get absPath(): string {
    return path.join(this.rootPath, this.relativePath);
  }

  toDocument(): LspDocument {
    if (!fs.existsSync(this.absPath)) {
      this.writeFile();
    }
    return LspDocument.createFromPath(this.absPath);
  }

  getType() {
    return this.toDocument().getAutoloadType();
  }

  withShebang(shebang: string = '#!/usr/bin/env fish'): TestFile {
    // Add shebang to the content if it's a string
    this.content = Array.isArray(this.content)
      ? [shebang, ...this.content]
      : `${shebang}\n${this.content}`;
    if (this.hasWritten) {
      // If the file has already been written, we need to rewrite it
      this.writeFile();
      this.hasWritten = true;
    }
    return this;
  }

  writeFile() {
    const dir = path.dirname(this.absPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.absPath, Array.isArray(this.content) ? this.content.join('\n') : this.content, 'utf8');
    this.hasWritten = true;
    return this;
  }

  static create(
    relativePath: string,
    content: string | string[] = '',
    rootPath: string = TestFile.baseDir,
  ): TestFile {
    return new TestFile(relativePath, content, rootPath).writeFile();
  }

  get relativeUri() {
    return pathToUri(this.relativePath);
  }

  get uri() {
    if (!this.hasWritten) {
      this.writeFile();
    }
    return pathToUri(this.absPath);
  }
  // static fromDocument(doc: LspDocument): TestFile {
  //   return new TestFile(doc.getRelativeFilenameToWorkspace(), doc.getText());
  // }
  //
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

  // writeFile() {
  //   const absPath = path.join(TestFile.rootDirPath, this.relativePath);
  //   const dir = path.dirname(absPath);
  //   if (!fs.existsSync(dir)) {
  //     fs.mkdirSync(dir, { recursive: true });
  //   }
  //   fs.writeFileSync(absPath, Array.isArray(this.content) ? this.content.join('\n') : this.content, 'utf8');
  // }
  //
  // withShebang(shebang: string = '#!/usr/bin/env fish'): TestFile {
  //   // Add shebang to the content if it's a string
  //   const contentWithShebang = Array.isArray(this.content)
  //     ? [shebang, ...this.content]
  //     : `${shebang}\n${this.content}`;
  //
  //   return new TestFile(this.relativePath, contentWithShebang);
  // }
}

export default class TestWorkspace {
  private files: TestFile[] = [];
  private _uniqDocuments: Set<string> = new Set();
  private _documents: LspDocument[] = [];
  private initialized: boolean = false;
  private _inspecting: boolean = false;
  public workspacePath: string;
  private _alwaysSnapshot: boolean = false;

  public static ROOT_PATH = path.resolve('tests/workspaces');

  constructor(
    public readonly name: string = generateRandomWorkspaceName(),
    public readonly isCurrent: boolean = true,
    public readonly config: Record<string, any> = {},
  ) {
    this.workspacePath = path.join(TestWorkspace.ROOT_PATH, this.name);
    if (fs.existsSync(this.workspacePath)) {
      let counter = 1;
      let newName = `${this.workspacePath}_${counter}`;
      while (fs.existsSync(newName)) {
        newName = `${this.workspacePath}_${counter}`;
        counter++;
      }
      fs.mkdirSync(newName, { recursive: true });
    }
  }

  get workspaceUri() {
    return pathToUri(this.workspacePath)!;
  }

  add(...files: TestFile[]) {
    files.forEach(file => {
      file.writeFile();
      this.files.push(file);
      if (!this._uniqDocuments.has(file.absPath)) {
        this._documents.push(file.toDocument());
        this._uniqDocuments.add(file.absPath);
      }
    });
    if (this.initialized) {
      workspaceManager.current!.addPending(...this._documents.map(doc => doc.uri));
    }
    return this;
  }

  // Don't remove the workspace after the test finishes
  inspect() {
    this._inspecting = true;
  }

  copyFromAutoloadedEnvVariable(sourcePath: string) {
    if (sourcePath.startsWith('$')) {
      try {
        const stdout = execFileSync('fish', ['-c', `echo ${sourcePath}`]).toString().trim();
        if (stdout !== sourcePath && !fs.existsSync(sourcePath) && fs.existsSync(stdout)) {
          sourcePath = stdout;
        }
      } catch (error) {
        if (this.config.debug) {
          logger.error(`Failed to expand environment variable: ${sourcePath}`);
        }
        return this;
      }
    }

    if (SyncFileHelper.isExpandable(sourcePath) && !SyncFileHelper.isAbsolutePath(sourcePath)) {
      sourcePath = SyncFileHelper.expandEnvVars(sourcePath);
    }

    if (!fs.existsSync(sourcePath)) {
      if (this.config.debug) {
        logger.warning(`Source path does not exist: ${sourcePath}`);
      }
      return this;
    }

    const fishDirs = ['functions', 'completions', 'conf.d'];
    const configFile = 'config.fish';
    const inheritedDocuments: LspDocument[] = [];

    // Copy config.fish if it exists
    const configPath = path.join(sourcePath, configFile);
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      this.add(TestFile.config(content));

      // Create document for tracking
      const configDoc = LspDocument.createFromUri(pathToUri(configPath));
      inheritedDocuments.push(configDoc);

      if (this.config.debug) {
        logger.log(`Inherited config.fish from: ${configPath}`);
      }
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

          // Add to files list
          this.add(TestFile.create(relativePath, content));

          // Create document for tracking
          const doc = LspDocument.createFromUri(pathToUri(filePath));
          inheritedDocuments.push(doc);

          if (this.config.debug) {
            logger.log(`Inherited ${relativePath} from: ${filePath}`);
          }
        }
      }
    }

    // Add all inherited documents to our workspace tracking
    this._documents.push(...inheritedDocuments);

    // If workspace is already initialized, add documents to it
    if (this.workspace) {
      for (const doc of inheritedDocuments) {
        this.workspace.addPending(doc.uri);
      }
    }

    if (this.config.debug) {
      logger.log(`Inherited ${inheritedDocuments.length} files from: ${sourcePath}`);
    }
    return this;
  }

  initialize(): TestWorkspace {
    if (this.initialized) return this;

    logger.setSilent();
    const workspace = Workspace.syncCreateFromUri(this.workspaceUri)!;

    beforeAll(async () => {
      logger.setSilent();
      await setupProcessEnvExecFile();
      await Analyzer.initialize();
      if (!workspace) {
        throw new Error(`Failed to create workspace from URI: ${this.workspaceUri}`);
      }
      workspaceManager.add(workspace);
      workspaceManager.setCurrent(workspace);
    });

    beforeEach(async () => {
      logger.setSilent();
      workspace?.setAllPending();
      this.initialized = false;
      this._documents.forEach(doc => {
        if (!fs.existsSync(doc.path)) {
          fs.writeFileSync(doc.path, doc.getText(), 'utf8');
        }
        workspace?.addPending(doc.uri);
      });
      await workspaceManager.analyzePendingDocuments();
      this.initialized = true;
    });

    afterAll(async () => {
      if (this._alwaysSnapshot) {
        this.writeSnapshot();
      }
      if (!this.initialized) return;
      workspaceManager.clear();
      this.initialized = false;
      this._documents = [];
      this._uniqDocuments.clear();
      this.files = [];
      if (!this._inspecting && fs.existsSync(this.workspacePath)) {
        fs.rmSync(this.workspacePath, { recursive: true });
      }
    });

    return this;
  }

  async forceInitialize() {
    logger.setSilent();
    await setupProcessEnvExecFile();
    await Analyzer.initialize();
    if (this.initialized) {
      return this;
    }
    if (!fs.existsSync(this.workspacePath)) {
      fs.mkdirSync(this.workspacePath, { recursive: true });
      // for (const file of this.files) {
      //   const filedir = path.dirname(file.toDocument().path);
      //   if (!fs.existsSync(filedir)) {
      //     fs.mkdirSync(filedir, { recursive: true });
      //   }
      // }
    }
    const workspace = Workspace.syncCreateFromUri(this.workspaceUri)!;
    if (!workspace) {
      throw new Error(`Failed to create workspace from URI: ${this.workspaceUri}`);
    }
    this._documents.forEach(doc => {
      if (!fs.existsSync(doc.path)) {
        fs.writeFileSync(doc.path, doc.getText(), 'utf8');
      }
      workspace?.addPending(doc.uri);
    });

    workspaceManager.add(workspace);
    workspaceManager.setCurrent(workspace);
    await workspaceManager.analyzePendingDocuments();
    this.initialized = true;
    return workspace;
  }

  get workspace(): Workspace {
    if (!this.initialized) {
      this.initialize();
    }
    return workspaceManager.current!;
  }

  get documents(): LspDocument[] {
    if (!this.initialized) {
      this.initialize();
    }
    return this._documents;
  }

  // Unified document access methods (DRY principle)
  public get(
    queryProp: Query | QueryConfig | string | unknown = '',
  ): LspDocument | undefined {
    return this.filter(queryProp as any)[0];
  }

  findDocumentByPath(searchPath: string): LspDocument | undefined {
    return this.filter(Query.create().withPath(searchPath))[0];
  }

  findDocumentsByName(name: string): LspDocument[] {
    return this.filter(Query.create().withName(name));
  }

  writeSnapshot(outputPath?: string): string {
    const timestamp = Date.now();
    const snapshotPath = outputPath || path.join(TestFile.baseDir, `${this.name}.snapshot`);
    const snapshot = JSON.stringify({
      path: this.workspacePath,
      files: this.documents.map(doc => ({ path: doc.path, text: doc.getText() })),
      timestamp,
    }, null, 2);
    fs.writeFileSync(snapshotPath, snapshot, 'utf8');
    return snapshotPath;
  }

  static findSnapshotPath(searchWorkspace: string | TestWorkspace) {
    if (searchWorkspace instanceof TestWorkspace) {
      return path.join(TestFile.baseDir, `${searchWorkspace.name}.snapshot`);
    } else if (typeof searchWorkspace === 'string') {
      if (fs.existsSync(path.join(TestFile.baseDir, `${searchWorkspace}.snapshot`))) {
        return path.join(TestFile.baseDir, `${searchWorkspace}.snapshot`);
      } else if (fs.existsSync(path.join(TestFile.baseDir, `${searchWorkspace}.json`))) {
        return path.join(TestFile.baseDir, `${searchWorkspace}.json`);
      }
    }
    // outputPath || path.join(TestFile._baseDir, `${this.name}.snapshot`);
    return undefined;
  }

  static fromSnapshot(path: string): TestWorkspace {
    if (!fs.existsSync(path)) {
      throw new Error(`Snapshot file does not exist: ${path}`);
    }
    const data = fs.readFileSync(path, 'utf8');
    const snapshot = JSON.parse(data);
    const newWorkspace = new TestWorkspace(snapshot.path, false);
    if (!snapshot || !snapshot.path || !Array.isArray(snapshot.files)) {
      throw new Error(`Invalid snapshot format in file: ${path}`);
    }
    const files = snapshot.files.map((file: { path: string; text: string; }) => {
      if (!file.path || typeof file.text !== 'string') {
        throw new Error(`Invalid file entry in snapshot: ${JSON.stringify(file)}`);
      }
      fs.writeFileSync(file.path, file.text, 'utf8');
      return { path: file.path, text: file.text };
    });

    newWorkspace.add(
      ...files,
    );
    return newWorkspace;
  }

  readSnapshot(path: string) {
    if (!fs.existsSync(path)) {
      throw new Error(`Snapshot file does not exist: ${path}`);
    }
    const data = fs.readFileSync(path, 'utf8');
    const snapshot = JSON.parse(data);
    const newWorkspace = new TestWorkspace(snapshot.path, false);
    if (!snapshot || !snapshot.path || !Array.isArray(snapshot.files)) {
      throw new Error(`Invalid snapshot format in file: ${path}`);
    }
    const files = snapshot.files.map((file: { path: string; text: string; }) => {
      if (!file.path || typeof file.text !== 'string') {
        throw new Error(`Invalid file entry in snapshot: ${JSON.stringify(file)}`);
      }
      fs.writeFileSync(file.path, file.text, 'utf8');
      return { path: file.path, text: file.text };
    });

    newWorkspace.add(
      ...files,
    );
    return newWorkspace;
  }

  /**
   * Dumps the file tree structure
   */
  dumpFileTree(): string {
    if (!fs.existsSync(this.workspacePath)) {
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

    tree.push(this.name + '/');
    buildTree(this.workspacePath, '');
    return tree.join('\n');
  }

  filter(
    ...queryProps: (Query | QueryConfig | string | unknown)[]
  ) {
    const result: LspDocument[] = [];
    for (const queryProp of queryProps) {
      const filteredDocs = this.filterHelper(queryProp);
      result.push(...filteredDocs);
    }
    return result;
  }

  private filterHelper(
    queryProp: Query | QueryConfig | string | unknown,
  ): LspDocument[] {
    if (!this.initialized) {
      this.initialize();
    }

    if (typeof queryProp === 'string') {
      return Query.create().withName(queryProp).execute(this.documents) ||
        Query.create().withPath(queryProp).execute(this.documents);
    } else if (QueryConfig.is(queryProp)) {
      return QueryConfig.to(queryProp).execute(this.documents);
    } else if (Query.is(queryProp)) {
      return queryProp.execute(this.documents);
    } else {
      return this.documents;
    }
  }

  find(...queryProps: (Query | QueryConfig | string | unknown)[]) {
    for (const queryProp of queryProps) {
      const filteredDocs = this.filterHelper(queryProp);
      if (filteredDocs.length > 0) {
        return filteredDocs[0];
      }
    }
  }

  edit(
    // queryProp: Query | QueryConfig | string | unknown,
    // content: string | string[] | ((doc: LspDocument) => string | string[]) = '',
    searchPath: string, newContent: string | string[],
  ) {
    if (!this.initialized) {
      throw new Error('Workspace must be initialized before editing files');
    }

    const doc = this.find(searchPath);
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

      // if (this._config.autoAnalyze) {
      //   analyzer.analyze(updatedDoc);
      // }
    }
    // )
  }

  static create(name: { name: string; }, isCurrent?: boolean, config?: Record<string, any>): TestWorkspace;
  static create(name: string, isCurrent?: boolean, config?: Record<string, any>): TestWorkspace;
  static create(name: string | { name: string; } = generateRandomWorkspaceName(), isCurrent: boolean = true, config: Record<string, any> = {}): TestWorkspace {
    // static create(
    //   name: string = generateRandomWorkspaceName(),
    //   isCurrent: boolean = true,
    //   config: Record<string, any> = {},
    // ): TestWorkspace {
    if (typeof name === 'object' && name.name) {
      return new TestWorkspace(name.name, isCurrent, config);
    }
    if (typeof name !== 'string') {
      throw new Error('Invalid workspace name');
    }
    return new TestWorkspace(name, isCurrent, config);
  }

  static createSingleFile(
    identifierName = generateRandomWorkspaceName(),
    content: string = `# ${identifierName} file content`,
  ): TestWorkspace {
    logger.setSilent();
    return new TestWorkspace(identifierName, true).add(
      TestFile.script(identifierName, content),
    );
  }

  forceDelete() {
    if (fs.existsSync(this.workspacePath)) {
      fs.rmdirSync(this.workspacePath, { recursive: true });
    }
  }
}

export class DefaultTestWorkspaces {
  /**
   * Creates a basic fish function workspace
   */
  static basicFunctions(): TestWorkspace {
    return TestWorkspace.create('basic_functions')
      .add(
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
    return TestWorkspace.create('complex_functions')
      .add(
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
    return TestWorkspace.create('config_and_events')
      .add(
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
    return TestWorkspace.create('project_workspace')
      .add(
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
