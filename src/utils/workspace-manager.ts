import { DocumentUri } from 'vscode-languageserver';
import { logger } from '../logger';
import { Workspace } from './workspace';

export class WorkspaceManager {
  private allWorkspaces: Map<string, Workspace> = new Map<string, Workspace>();
  private currentWorkspace: Workspace | undefined = undefined;
  private historyStack: Workspace[] = [];

  public copy(workspaceManager: WorkspaceManager): void {
    this.allWorkspaces = new Map<string, Workspace>(workspaceManager.allWorkspaces);
    this.currentWorkspace = workspaceManager.currentWorkspace;
    this.historyStack = [...workspaceManager.historyStack];
  }

  public addWorkspace(workspace: Workspace): void {
    if (this.allWorkspaces.has(workspace.uri)) {
      return;
    }
    this.allWorkspaces.set(workspace.uri, workspace);
  }

  public removeWorkspace(workspace: Workspace): void {
    const workspaceCount = this.historyStack.filter(w => w.equals(workspace)).length;
    if (workspaceCount === 1) {
      this.allWorkspaces.delete(workspace.uri);
      this.currentWorkspace = undefined;
      this.historyStack.pop();
    }
    // if (this.previousWorkspace && !this.previousWorkspace.equals(workspace)) {
    //   this.historyStack.pop();
    //   const prev = this.previousWorkspace;
    //   this.currentWorkspace = prev;
    //   return;
    // }
    if (this.current && this.current.equals(workspace)) {
      this.allWorkspaces.delete(this.current.uri);
      this.currentWorkspace = undefined;
      const prev = this.historyStack.pop();
      if (prev) {
        this.currentWorkspace = prev;
      } else {
        this.currentWorkspace = undefined;
      }
    }
  }

  removeLast() {
    const removed = this.historyStack.pop();
    if (removed) this.allWorkspaces.delete(removed.uri);
    if (this.historyStack.length > 0) {
      this.currentWorkspace = this.historyStack.at(-1);
    } else {
      this.currentWorkspace = undefined;
    }
    // return this.currentWorkspace;
    return removed;
  }

  public get allWorkspacePaths() {
    return this.workspaces.map((workspace) => workspace.path);
  }

  public findWorkspace(workspaceUri: string): Workspace | undefined {
    return this.allWorkspaces.get(workspaceUri);
  }

  public exists(workspaceUri: string): string | undefined {
    for (const workspace of this.workspaces) {
      if (workspace.uri === workspaceUri) {
        return workspaceUri;
      }
    }
    return undefined;
  }

  // returns true if the newly set workspace is different from the previous one
  public setCurrent(workspace: Workspace): boolean {
    this.allWorkspaces.set(workspace.uri, workspace);
    let didUpdate = false;
    const prev = this.previousWorkspace;
    if (!prev || !prev.equals(workspace)) {
      this.historyStack.push(workspace);
      didUpdate = true;
    }
    this.currentWorkspace = workspace;
    return didUpdate;
  }

  public set current(workspace: Workspace) {
    this.currentWorkspace = workspace;
    if (!this.allWorkspaces.has(workspace.uri)) {
      this.allWorkspaces.set(workspace.uri, workspace);
    }
    if (this.historyStack.length > 0) {
      const prev = this.historyStack.at(-1);
      if (prev && !prev.equals(workspace)) {
        this.historyStack.push(workspace);
      }
    } else {
      this.historyStack.push(workspace);
    }
  }

  public get current(): Workspace | undefined {
    return this.currentWorkspace;
  }

  public get workspaces(): Workspace[] {
    const workspaces: Workspace[] = [];
    for (const workspace of Array.from(this.allWorkspaces.values())) {
      workspaces.push(workspace);
    }
    return workspaces;
  }

  // use WorkspaceManager.current to get the current workspace
  public updateCurrentFromUri(uri: DocumentUri): {
    didUpdate: boolean;
    workspace: Workspace | undefined | null;
  } {
    for (const workspace of this.workspaces) {
      if (workspace.contains(uri)) {
        this.current = workspace;
        return { didUpdate: this.setCurrent(workspace), workspace };
      }
    }
    const newWorkspace = Workspace.syncCreateFromUri(uri);
    if (!newWorkspace) {
      logger.warning(`No workspace found for URI: ${uri}`);
      return { didUpdate: false, workspace: undefined };
    }
    this.current = newWorkspace;
    return {
      didUpdate: true,
      workspace: newWorkspace,
    };
  }

  orderedWorkspaces(): Workspace[] {
    const result = [
      ...this.current ? [this.current] : [],
      ...this.historyStack.length > 0 ? this.historyStack.slice(1) : [],
      ...this.workspaces,
    ].filter(Boolean) as Workspace[];

    const allWorkspaces: Workspace[] = [];
    result.forEach((workspace) => {
      if (allWorkspaces.filter(w => w.equals(workspace)).length === 0) {
        allWorkspaces.push(workspace);
      }
    });
    return allWorkspaces;
  }

  public getWorkspacesToAnalyze(): Workspace[] {
    const workspaces: Workspace[] = [];
    for (const workspace of this.workspaces) {
      if (!workspace.isAnalyzed()) {
        workspaces.push(workspace);
      }
    }
    return workspaces;
  }

  public needsAnalysis(): boolean {
    return this.getWorkspacesToAnalyze().length > 0;
  }

  public findContainingWorkspace(uri: DocumentUri): Workspace | undefined {
    return this.workspaces.find((ws) => ws.uris.has(uri) || ws.uri === uri);
  }

  public allNewUrisToAnalyze(): { documentUris: string[]; items: { [workspaceUri: string]: string[]; }; } {
    const allDocumentUris: string[] = [];
    const items: { [workspaceUri: string]: string[]; } = {};
    for (const workspace of this.orderedWorkspaces()) {
      if (!workspace.isAnalyzed()) {
        allDocumentUris.push(...workspace.urisToAnalyze);
        items[workspace.uri] = workspace.urisToAnalyze;
      }
    }
    return {
      documentUris: allDocumentUris,
      items: items,
    };
  }

  public updateDocumentAnalysis(...uris: DocumentUri[]): void {
    for (const uri of uris) {
      const workspace = this.findContainingWorkspace(uri);
      workspace?.analyzedUri(uri);
    }
  }

  public get previousWorkspace(): Workspace | undefined {
    if (this.historyStack.length >= 1) {
      return this.historyStack.at(-1);
    }
    return undefined;
  }

  clear() {
    this.allWorkspaces.clear();
    this.currentWorkspace = undefined;
    this.historyStack = [];
  }
}

export const workspaces = new WorkspaceManager();
