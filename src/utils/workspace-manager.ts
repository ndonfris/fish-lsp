import { DocumentUri, WorkDoneProgressServerReporter, WorkspaceFoldersChangeEvent } from 'vscode-languageserver';
import { logger } from '../logger';
import { Workspace, WorkspaceUri } from './workspace';
import { documents, LspDocument } from '../document';
import { analyzer } from '../analyze';
import { config } from '../config';
import { isPath, PathLike, pathToUri } from './translation';

export class WorkspaceManager {
  private stack: WorkspaceStack = new WorkspaceStack();
  private allWorkspaces: Map<string, Workspace> = new Map<string, Workspace>();

  /**
   * Method to copy the current workspace manager (for testing purposes).
   */
  public copy(workspaceManager: WorkspaceManager) {
    this.allWorkspaces = new Map<string, Workspace>(workspaceManager.allWorkspaces);
    this.stack = this.stack.copy(workspaceManager.stack);
    return this;
  }

  /**
   * Set the current workspace to the given workspace.
   * This method will add the workspace to the history stack and include it in the map of all workspaces.
   * A workspace that is already stored in the history stack will be removed from its old index, and
   * set to the top of the stack.
   */
  public setCurrent(workspace: Workspace) {
    this.allWorkspaces.set(workspace.uri, workspace);
    this.stack.push(workspace);
    return this.stack.current;
  }

  /**
   * Get the current workspace, if it exists.
   */
  public get current(): Workspace | undefined {
    return this.stack.current;
  }

  // adds a workspace to the map of all workspaces, but does not add it to the stack
  // that stores the current workspace
  public add(...workspaces: Workspace[]): void {
    workspaces.forEach((workspace) => {
      if (this.allWorkspaces.has(workspace.uri)) {
        return;
      }
      this.allWorkspaces.set(workspace.uri, workspace);
    });
  }

  // removes a workspace from the map of all workspaces and the history stack
  public remove(...workspaces: Workspace[]): void {
    workspaces.forEach((w) => {
      if (this.allWorkspaces.has(w.uri)) {
        this.allWorkspaces.delete(w.uri);
      }
    });
    this.stack.remove(...workspaces);
  }

  public findContainingWorkspace(uri: DocumentUri): Workspace | null;
  public findContainingWorkspace(docPath: PathLike): Workspace | null;
  public findContainingWorkspace(document: LspDocument): Workspace | null;
  public findContainingWorkspace(doc: DocumentUri | LspDocument): Workspace | null;
  public findContainingWorkspace(doc: DocumentUri | LspDocument): Workspace | null {
    const documentUri = this.getDocumentUriFromParams(doc);
    return this.getWorkspaceContainingUri(documentUri);
  }

  public hasContainingWorkspace(uri: DocumentUri): boolean;
  public hasContainingWorkspace(docPath: PathLike): boolean;
  public hasContainingWorkspace(document: LspDocument): boolean;
  public hasContainingWorkspace(doc: DocumentUri | LspDocument): boolean;
  public hasContainingWorkspace(doc: DocumentUri | LspDocument): boolean {
    const documentUri = this.getDocumentUriFromParams(doc);
    return this.allWorkspaces.has(documentUri);
  }

  /**
   * Removes any workspace that is stored in this class (useful for testing).
   */
  public clear(): this {
    this.allWorkspaces.clear();
    this.stack.clear();
    return this;
  }

  /**
   * Get an array of all the workspaces that are currently stored in this class.
   * The resulting array will be sorted by workspaces opened most recently, followed
   * by the workspaces that are not opened but are still indexed.
   */
  public get all() {
    const uniqueWorkspaces = new Set<WorkspaceUri>();
    const result: Workspace[] = [];
    this.stack.allOpened.forEach((workspace) => {
      result.push(workspace);
      uniqueWorkspaces.add(workspace.uri);
    });
    this.allWorkspaces.forEach((workspace) => {
      if (!uniqueWorkspaces.has(workspace.uri)) {
        result.push(workspace);
        uniqueWorkspaces.add(workspace.uri);
      }
    });
    return result;
  }

  /**
   * get all document uris across all workspaces
   */
  public get allUrisInAllWorkspaces(): DocumentUri[] {
    const result: DocumentUri[] = [];
    this.all.forEach((workspace) => {
      result.push(...Array.from(workspace.allUris));
    });
    return result;
  }

  /**
   * get all workspaces that need indexing to be done to their documents
   */
  public workspacesToAnalyze(): Workspace[] {
    return this.all.filter((workspace) => workspace.needsAnalysis());
  }

  /**
   * Checks if any workspace exists which needs to be analyzed by the analyzePendingDocuments() method.
   */
  public needsAnalysis(): boolean {
    return this.workspacesToAnalyze().length > 0;
  }

  /**
   * Get all workspaces that contain the given document (since a document can be in multiple workspaces).
   */
  public allWorkspacesWithDocument(doc: LspDocument): Workspace[] {
    return this.all.filter((workspace) => workspace.contains(doc.uri));
  }

  /**
   * Get all documents that need analysis across all workspaces.
   * This method is used to find documents that are pending analysis.
   * The resulting documents are unique (i.e., documents in multiple workspaces are not duplicated).
   */
  public allAnalysisDocuments(): LspDocument[] {
    const uniqueUris = new Set<DocumentUri>();
    const result: LspDocument[] = [];
    for (const workspace of this.workspacesToAnalyze()) {
      const pendingDocuments = workspace.pendingDocuments();
      pendingDocuments.forEach((doc) => {
        if (!uniqueUris.has(doc.uri)) {
          uniqueUris.add(doc.uri);
          result.push(doc);
        }
      });
    }
    return result;
  }

  public get isLargeAnalysis(): boolean {
    return this.allAnalysisDocuments().length > 25;
  }

  /**
   * Check if the workspace manager already has a workspace that contains the given URI.
   */
  private getWorkspaceContainingUri(uri: DocumentUri): Workspace | null {
    return this.all.find((workspace) =>
      workspace.uris.has(uri) || workspace.uri === uri,
    ) || null;
  }

  /**
   * Get the existing workspace or create a new one if it doesn't exist.
   * This method is used to handle the case where a document is opened or edited.
   */
  private getExistingWorkspaceOrCreateNew(uri: DocumentUri): Workspace | null {
    const existingWorkspace = this.getWorkspaceContainingUri(uri);
    if (existingWorkspace) return existingWorkspace;
    const newWorkspace = Workspace.syncCreateFromUri(uri);
    if (!newWorkspace) {
      logger.error(`Failed to create workspace from URI: ${uri}`);
      return null;
    }
    return newWorkspace;
  }

  /**
   * Get the document URI from the given parameters.
   */
  private getDocumentUriFromParams(document: LspDocument): string;
  private getDocumentUriFromParams(documentUri: DocumentUri): string;
  private getDocumentUriFromParams(documentPath: PathLike): string;
  private getDocumentUriFromParams(param: DocumentUri | LspDocument | PathLike): string;
  private getDocumentUriFromParams(param: DocumentUri | LspDocument | PathLike): string {
    if (LspDocument.is(param)) return param.uri.toString();
    if (DocumentUri.is(param)) return param.toString();
    if (isPath(param)) return pathToUri(param).toString();
    return '';
  }

  /**
   * Handle the opening of a document.
   * This method is used to open the document in the documents manager, analyze it,
   * set the current workspace, then add the sourced uris to the workspace, lastly
   * analyze the workspace if needed.
   */
  public handleOpenDocument(document: LspDocument): Workspace | null;
  public handleOpenDocument(documentUri: DocumentUri): Workspace | null;
  public handleOpenDocument(documentUri: DocumentUri | LspDocument): Workspace | null;
  public handleOpenDocument(doc: DocumentUri | LspDocument): Workspace | null {
    logger.info('workspaceManager.handleOpenDocument()', 'Opening document', doc);
    const documentUri = this.getDocumentUriFromParams(doc);
    documents.open(documentUri);
    const document = documents.getDocument(documentUri);
    const newWorkspace = this.getExistingWorkspaceOrCreateNew(documentUri);
    if (!newWorkspace || !document) {
      logger.error(
        'workspaceManager.handleOpenDocument()',
        `Failed to create or find workspace for URI: ${documentUri}`,
        { params: doc },
      );
      return null;
    }
    analyzer.analyze(document);
    newWorkspace.add(...Array.from(analyzer.collectAllSources(documentUri)));
    this.setCurrent(newWorkspace);
    if (newWorkspace.needsAnalysis()) {
      logger.info(`workspaceManager.handleOpenDocument() - Workspace('${newWorkspace.name}').needsAnalysis()`);
      analyzer.analyzeWorkspace(newWorkspace);
    }
    return this.current as Workspace;
  }

  /**
   * Handle the closing of a document.
   * This method is used to remove the document from the workspace and close it in the documents manager.
   */
  public handleCloseDocument(document: LspDocument): Workspace | null;
  public handleCloseDocument(documentUri: DocumentUri): Workspace | null;
  public handleCloseDocument(doc: DocumentUri | LspDocument): Workspace | null;
  public handleCloseDocument(doc: DocumentUri | LspDocument): Workspace | null {
    logger.info('workspaceManager.handleCloseDocument()', 'Closing document', { params: doc });
    const totalUrisBeforeRemoval = this.allUrisInAllWorkspaces.length;
    const documentUri = this.getDocumentUriFromParams(doc);
    const workspace = this.getWorkspaceContainingUri(documentUri);
    documents.close(documentUri);
    if (!workspace) {
      logger.error(
        'workspaceManager.handleCloseDocument()',
        `Failed to find workspace for URI: ${documentUri}`,
        { params: doc },
      );
      return null;
    }
    const docsInWorkspace = documents.openDocuments.filter(doc =>
      workspace.contains(doc.uri) && this.allWorkspacesWithDocument(doc).length === 1,
    );
    if (docsInWorkspace.length === 0) this.remove(workspace);
    logger.info('workspaceManager.handleCloseDocument()', {
      priorToRemoval: totalUrisBeforeRemoval,
      removedUris: workspace.allUris.size,
      remainingUris: this.allUrisInAllWorkspaces.length,
      currentWorkspace: this.current?.name,
      removedWorkspaces: workspace.name,
      removedDocument: documentUri,
      currentDocuments: documents.openDocuments.map((doc) => doc.uri),
    });
    return this.current || null;
  }

  /**
   * Handle updating the current workspace when a document is updated
   * Does not handle updating the document itself.
   */
  public handleUpdateDocument(document: LspDocument): Workspace | null;
  public handleUpdateDocument(documentUri: DocumentUri): Workspace | null;
  public handleUpdateDocument(doc: DocumentUri | LspDocument): Workspace | null;
  public handleUpdateDocument(doc: DocumentUri | LspDocument): Workspace | null {
    logger.info('workspaceManager.handleUpdateDocument()', 'Updating document:', doc);
    const documentUri = this.getDocumentUriFromParams(doc);
    const workspace = this.getExistingWorkspaceOrCreateNew(documentUri);
    if (!workspace) {
      logger.error(
        'workspaceManager.handleUpdateDocument()',
        `Failed to find workspace for URI: ${documentUri}`,
      );
      return null;
    }
    this.setCurrent(workspace);
    const document = documents.getDocument(documentUri);
    if (document) {
      analyzer.analyze(document);
      workspace.addPending(documentUri);
      workspace.addPending(...Array.from(analyzer.collectAllSources(documentUri)));
    }
    return this.current!;
  }

  /**
   * Handle the workspace change event, which is triggered when a workspace is added or removed
   * This method will update the map of all workspaces and the resulting workspaces will be
   * re-analyzed.
   */
  public handleWorkspaceChangeEvent(event: WorkspaceFoldersChangeEvent, progress?: ProgressWrapper): void {
    progress?.begin('[fish-lsp] indexing files', 0, `Analyzing ${event.added.length} workspace${event.added.length > 1 ? 's' : ''}`, true);
    logger.info(
      'workspaceManager.handleWorkspaceChangeEvent()',
      `Workspace change event: { added: ${event.added.length}, removed: ${event.removed.length}} `,
      {
        added: event.added.map((ws) => ws.uri),
        removed: event.removed.map((ws) => ws.uri),
      },
    );
    event.added.forEach((workspace) => {
      const foundWorkspace = this.getExistingWorkspaceOrCreateNew(workspace.uri);
      if (foundWorkspace) {
        this.add(foundWorkspace);
      } else {
        logger.warning(
          'workspaceManager.handleWorkspaceChangeEvent()',
          `FAILED: event.added: ${workspace.uri}`,
        );
      }
    });
    event.removed.forEach((workspace) => {
      const foundWorkspace = this.getExistingWorkspaceOrCreateNew(workspace.uri);
      if (foundWorkspace) {
        this.remove(foundWorkspace);
      } else {
        logger.warning(
          'workspaceManager.handleWorkspaceChangeEvent()',
          `FAILED event.removed: ${workspace.uri}`,
        );
      }
    });
  }

  /**
   * Analyze all documents that need analysis, across all workspaces.
   * ___
   *
   * NOTE: if the user sets an arbitrarily low value for fish_lsp_max_background_files, this method will need to be called multiple times.
   *
   * ```typescript
   * while (workspaceManager.needsAnalysis()) {
   *   workspaceManager.analyzePendingDocuments();
   * }
   * ```
   * ___
   * @param progress - Optional progress wrapper to report progress.
   * @param callbackfn - Optional callback function to handle progress messages.
   * @returns An object containing the analyzed items, total documents, and duration of analysis.
   */
  public async analyzePendingDocuments(
    progress: ProgressWrapper | WorkDoneProgressServerReporter | undefined = undefined,
    callbackfn: (str: string) => void = (s) => logger.log(s),
  ) {
    logger.info('workspaceManager.analyzePendingDocuments()');
    const items: { [workspacePath: PathLike]: string[]; } = {};
    const startTime = performance.now();

    // get all documents that need analysis
    const pendingDocuments = this.allAnalysisDocuments();
    const maxSize = Math.min(pendingDocuments.length, config.fish_lsp_max_background_files);
    const currentDocuments = pendingDocuments.slice(0, maxSize);

    // Helper function to delay execution
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // Calculate adaptive delay and batch size based on document count
    const BATCH_SIZE = Math.max(1, Math.floor(currentDocuments.length / 20));
    const UPDATE_DELAY = currentDocuments.length > 100 ? 10 : 25; // Shorter delay for large sets

    let lastUpdateTime = 0;
    const MIN_UPDATE_INTERVAL = 15; // Minimum ms between visual updates

    // Process documents in batches
    for (let idx = 0; idx < currentDocuments.length; idx++) {
      const doc = currentDocuments[idx]!;

      // Process the document
      const workspaces = this.allWorkspacesWithDocument(doc);
      workspaces.forEach((workspace) => {
        workspace.uris.markIndexed(doc.uri);
        const uris = items[workspace.path] || [];
        uris.push(doc.uri);
        items[workspace.path] = uris;
      });

      try {
        if (doc.getAutoloadType() === 'completions') {
          analyzer.analyzePartial(doc);
        } else {
          analyzer.analyze(doc);
        }
      } catch (error) {
        logger.error(
          'workspaceManager.analyzePendingDocuments()',
          `Error analyzing document: ${doc.uri}`,
          { error },
        );
      }

      // Only update progress on batch completion or significant percentage change
      const currentTime = performance.now();
      const isLastItem = idx === currentDocuments.length - 1;
      const isBatchEnd = idx % BATCH_SIZE === BATCH_SIZE - 1;
      const timeToUpdate = currentTime - lastUpdateTime > MIN_UPDATE_INTERVAL;

      if (isLastItem || isBatchEnd && timeToUpdate) {
        const percentage = Math.ceil((idx + 1) / maxSize * 100);
        progress?.report(`${percentage}% Analyzing ${idx + 1}/${maxSize} ${maxSize > 1 ? 'documents' : 'document'}`);
        lastUpdateTime = currentTime;

        // Add a small delay for visual perception
        await delay(UPDATE_DELAY);
      }
    }

    const endTime = performance.now();
    const duration = ((endTime - startTime) / 1000).toFixed(5);
    const message = `Analyzed ${currentDocuments.length} document${currentDocuments.length > 1 ? 's' : ''} in ${duration}s`;

    callbackfn(message);
    logger.info(
      'workspaceManager.analyzePendingDocuments()',
      message,
      {
        duration: `${duration}s`,
        totalDocuments: currentDocuments.length,
        maxSize,
      },
    );

    return {
      items,
      totalDocuments: currentDocuments.length,
      duration: (endTime - startTime) / 1000,
    };
  }
  // public async analyzePendingDocuments(
  //   progress: ProgressWrapper | WorkDoneProgressServerReporter | undefined = undefined,
  //   callbackfn: (str: string) => void = (s) => logger.log(s),
  // ) {
  //   logger.info('workspaceManager.analyzePendingDocuments()');
  //   const items: { [workspacePath: PathLike]: string[]; } = {};
  //   const startTime = performance.now();
  //
  //   // get all documents that need analysis
  //   const pendingDocuments = this.getAllDocumentsNeedingAnalysis();
  //   const maxSize = Math.min(pendingDocuments.length, config.fish_lsp_max_background_files);
  //   // resize the array to the max size, if it is larger than the max size configured
  //   const currentDocuments = pendingDocuments.slice(0, maxSize);
  //
  //   // Helper function to delay execution
  //   const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  //
  //   // Process documents with delay between progress updates
  //   for (let idx = 0; idx < currentDocuments.length; idx++) {
  //     const doc = currentDocuments[idx]!;
  //
  //     // find all the workspaces that contain the document
  //     const workspaces = this.allWorkspacesWithDocument(doc);
  //
  //     // keep track of the uris indexed in each workspace
  //     workspaces.forEach((workspace) => {
  //       workspace.uris.markIndexed(doc.uri);
  //       const uris = items[workspace.path] || [];
  //       uris.push(doc.uri);
  //       items[workspace.path] = uris;
  //     });
  //
  //     // analyze the document
  //     try {
  //       if (doc.getAutoloadType() === 'completions') {
  //         analyzer.analyzePartial(doc);
  //       } else {
  //         analyzer.analyze(doc);
  //       }
  //     } catch (error) {
  //       logger.error(
  //         'workspaceManager.analyzePendingDocuments()',
  //         `Error analyzing document: ${doc.uri}`,
  //         { error }
  //       );
  //     }
  //
  //     // report progress with delay
  //     const percentage = Math.ceil(((idx / maxSize) * 100));
  //     progress?.report(`${percentage}% Analyzing ${idx + 1}/${maxSize} document${maxSize > 1 ? 's' : ''}`);
  //
  //     // Add a short delay between iterations (50ms seems reasonable)
  //     await delay(1);
  //   }
  //
  //   const endTime = performance.now();
  //   const duration = ((endTime - startTime) / 1000).toFixed(5);
  //   const message = `Analyzed ${currentDocuments.length} document${currentDocuments.length > 1 ? 's' : ''} in ${duration}s`;
  //
  //   callbackfn(message);
  //   logger.info(
  //     'workspaceManager.analyzePendingDocuments()',
  //     message,
  //     {
  //       duration: `${duration}s`,
  //       totalDocuments: currentDocuments.length,
  //       maxSize,
  //     }
  //   );
  //
  //   return {
  //     items,
  //     totalDocuments: currentDocuments.length,
  //     duration: ((endTime - startTime) / 1000),
  //   };
  // }

  // public analyzePendingDocuments(
  //   progress: ProgressWrapper | WorkDoneProgressServerReporter | undefined = undefined,
  //   callbackfn: (str: string) => void = (s) => logger.log(s),
  // ) {
  //   logger.info('workspaceManager.analyzePendingDocuments()');
  //   const items: { [workspacePath: PathLike]: string[]; } = {};
  //   const startTime = performance.now();
  //   // get all documents that need analysis
  //   const pendingDocuments = this.getAllDocumentsNeedingAnalysis();
  //   const maxSize = Math.min(pendingDocuments.length, config.fish_lsp_max_background_files);
  //   // resize the array to the max size, if it is larger than the max size configured
  //   const currentDocuments = pendingDocuments.slice(0, maxSize);
  //   /* connection.window.createWorkDoneProgress().then((progress) => { */
  //   // progress.begin('fish-lsp', 0, 'Analyzing', true);
  //   currentDocuments.forEach((doc, idx) => {
  //     // find all the workspaces that contain the document
  //     const workspaces = this.allWorkspacesWithDocument(doc);
  //     // keep track of the uris indexed in each workspace
  //     // note: a document can be in multiple workspaces
  //     workspaces.forEach((workspace) => {
  //       workspace.uris.markIndexed(doc.uri);
  //       const uris = items[workspace.path] || [];
  //       uris.push(doc.uri);
  //       items[workspace.path] = uris;
  //     });
  //     // analyze the document, some documents may not require full analysis
  //     try {
  //       if (doc.getAutoloadType() === 'completions') {
  //         analyzer.analyzePartial(doc);
  //       } else {
  //         analyzer.analyze(doc);
  //       }
  //     } catch (error) {
  //       logger.error(
  //         'workspaceManager.analyzePendingDocuments()',
  //         `Error analyzing document: ${doc.uri}`,
  //         { error }
  //       );
  //     }
  //     // report progress if the percentage has changed
  //     const percentage = Math.ceil(((idx / maxSize) * 100));
  //     // setTimeout(() => {
  //     //   progress?.report(`${idx}/${maxSize}`);
  //     //   if (progress) {
  //     //   }
  //     progress?.report(`${percentage}% Analyzing ${idx + 1}/${maxSize} ${workspaceManager.current?.name || ''}`);
  //     // }, 2);
  //   });
  //   // progress?.done()
  //
  //   // progress?.report(100, 'Analyzing completed');
  //   const endTime = performance.now();
  //   const duration = ((endTime - startTime) / 1000).toFixed(5); // Convert to seconds with 2 decimal places
  //   const message = `Analyzed ${currentDocuments.length} document${currentDocuments.length > 1 ? 's' : ''} in ${duration}s`;
  //   // progress?.report(100, message);
  //   callbackfn(message);
  //   logger.info(
  //     'workspaceManager.analyzePendingDocuments()',
  //     message,
  //     {
  //       duration: `${duration}s`,
  //       totalDocuments: currentDocuments.length,
  //       maxSize,
  //     }
  //   );
  //   // progress?.done();
  //   // });
  //   return {
  //     items,
  //     totalDocuments: currentDocuments.length,
  //     duration: ((endTime - startTime) / 1000),
  //   };
  // }
}

/***
 * A utility class to manage history ordering of workspaces.
 *
 * When a workspace is opened, it is pushed to the top of the stack.
 *
 * A workspace that is already in the stack will be removed from its old index, and
 * set to the top of the stack (items in the stack are unique workspaces).
 *
 * When a workspace is closed, it is removed from the stack. The stack then allows
 * for the server to set the current workspace to the last opened workspace.
 *
 * The top of the stack is the last indexed item, and the bottom of the stack is the
 * first indexed item. This is the reason for the `toReversed()` usage when the
 * `allOpened` method is called. The allOpened method allows for iterating over the
 * workspace history in the order of most to least recently opened workspaces.
 */
class WorkspaceStack {
  private stack: Workspace[] = [];

  public copy(workspaceStack: WorkspaceStack) {
    this.stack = [...workspaceStack.stack];
    return this;
  }

  public push(workspace: Workspace): void {
    if (this.has(workspace)) this.remove(workspace);
    this.stack.push(workspace);
  }

  public pop(): Workspace | undefined {
    return this.stack.pop();
  }

  public get current(): Workspace | undefined {
    return this.stack[this.stack.length - 1];
  }

  public get allOpened(): Workspace[] {
    return this.stack.toReversed();
  }

  public findIndex(workspace: Workspace): number {
    return this.stack.findIndex((w) => w.uri === workspace.uri);
  }

  public has(workspace: Workspace): boolean {
    return this.stack.some((w) => w.uri === workspace.uri);
  }

  public isEmpty(): boolean {
    return this.stack.length === 0;
  }

  public clear(): void {
    this.stack = [];
  }

  public get length(): number {
    return this.stack.length;
  }

  public remove(...workspaces: Workspace[]): void {
    this.stack = this.stack.filter((w) =>
      !workspaces.some((ws) => ws.equals(w)),
    );
  }
}

/**
 * The global singleton instance of the workspace manager.
 * Use this object to:
 *  - retrieve the current workspace
 *  - update the current workspace
 *  - add or remove new workspaces,
 *  - analyze pending documents, across all workspaces
 *  - maintain workspace ordering based on recency of opening/closing
 */
export const workspaceManager = new WorkspaceManager();
