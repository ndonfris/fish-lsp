import * as LSP from 'vscode-languageserver';
import { Connection, WorkDoneProgressReporter } from 'vscode-languageserver';
import { Workspace } from './workspace';
import { config } from '../config';


/**
 * Create the progress token for the workspace progress token.
 */
export namespace AnalyzeProgressToken {
  /**
   * Create the progress token for the workspace progress token.
   */
  export async function create(
    connection: Connection,
    workspace: Workspace,
  ): Promise<ProgressWrapper> {
    if (ProgressTokens.has(workspace)) {
      const token = ProgressTokens.get(workspace);
      if (token) {
        token.done();
        ProgressTokens.delete(workspace);
      }
    }
    const progress = await connection.window.createWorkDoneProgress();
    const workspaceMaxSize = Math.min(workspace.paths.length, config.fish_lsp_max_background_files);
    const progressWrapper = new ProgressWrapper(progress, connection);

    progressWrapper.begin(workspace.name, 0, `analyzing ${workspaceMaxSize} file${workspaceMaxSize > 1 ? 's' : ''}`, true);
    // https://github.com/ndonfris/fish-lsp/pull/78#issuecomment-2820933206
    // https://github.com/microsoft/vscode-extension-samples/blob/main/notifications-sample/src/extension.ts
    return progressWrapper;
  }

  /**
   * Create the callback function for the workspace progress token.
   */
  export function callbackfn(
    connection: Connection,
  ) {
    return async function (workspace: Workspace) {
      return await create(connection, workspace);
    };
  }
}

/**
 * Wrapper for the WorkdoneProgressReporter, built by the namespace defined above (AnalyzeProgressToken).
 * This class is used to manage the progress of our analysis inside a workspace.
 */
export class ProgressWrapper implements WorkDoneProgressReporter {
  private status: 'created' | 'inProgress' | 'finished' | 'cancelled' = 'created';
  private name: string = '';

  constructor(
    public _progress: LSP.WorkDoneProgressServerReporter,
    private connection: LSP.Connection,
  ) { }

  begin(title: string, percentage?: number, message?: string, cancellable?: boolean): void {
    this.status = 'inProgress';
    this._progress.begin(`[fish-lsp] ${title}`, percentage, message, cancellable);
    this.name = title;
    // ProgressTokens.add(title, this);
    this._progress.token.onCancellationRequested((e) => {
      e.then(() => {
        this.status = 'cancelled';
        this._progress.report(0, "Cancelled");
      });
    });
  }

  report(percentage: number): void;
  report(message: string): void;
  report(percentage: number, message: string): void; // Add this third overload
  report(percentageOrString: number | string, message?: string): void {
    // this.connection.sendNotification('$/progress',
    //   {
    //     kind: 'report',
    //     percentage: typeof percentageOrString === 'number' ? percentageOrString : undefined,
    //     message: typeof percentageOrString === 'string' ? percentageOrString : message,
    //   });
    if (typeof percentageOrString === 'number' && typeof message === 'string') {
      this._progress.report(percentageOrString, message);
    } else if (typeof percentageOrString === 'number') {
      this._progress.report(percentageOrString);
    } else if (typeof percentageOrString === 'string') {
      this._progress.report(percentageOrString);
    }
  }

  done(): void {
    if (this.status === 'finished') {
      return;
    }
    this.status = 'finished';
    this._progress.report(100, "Completed");
    const WorkDoneProgressReporterImpl = this._progress.constructor as Record<string, any>;
    if (WorkDoneProgressReporterImpl && WorkDoneProgressReporterImpl.Instances instanceof Map && ('_token' in this._progress && (typeof this._progress._token === 'number' || typeof this._progress._token === 'string'))) {
      WorkDoneProgressReporterImpl.Instances.delete(this._progress.token);
      this.connection.sendProgress(LSP.WorkDoneProgress.type, this._progress._token, {
        kind: 'end',
        message: 'Analysis complete',
      });
    } else {
      this.connection.sendProgress(LSP.WorkDoneProgress.type, this.name, {
        kind: 'end',
        message: 'Analysis complete',
      });
      this._progress.done();
    }
    // ProgressTokens.delete(this.name);
  }
  isCanceled(): boolean {
    return this.status === 'cancelled';
  }

  isFinished(): boolean {
    return this.status === 'finished';
  }
}

type WorkspaceName = string;
export class ProgressTokens {

  private tokens: Map<WorkspaceName, ProgressWrapper> = new Map<WorkspaceName, ProgressWrapper>();
  private static _instance: ProgressTokens;

  constructor() { }

  static initialize() {
    return new ProgressTokens();
  }

  private static get instance() {
    if (!this._instance) {
      this._instance = new ProgressTokens();
    }
    return this._instance;
  }

  static has(workspaceUri: string): boolean;
  static has(workspace: Workspace): boolean;
  static has(workspace: Workspace | WorkspaceName): boolean {
    if (typeof workspace === 'string') {
      return this.instance.tokens.has(workspace);
    }
    if (workspace instanceof Workspace) {
      return this.instance.tokens.has(workspace.name);
    }
    return false;
  }

  static get(workspaceUri: string): ProgressWrapper | undefined; 
  static get(workspace: Workspace): ProgressWrapper | undefined;
  static get(workspace: Workspace | WorkspaceName): ProgressWrapper | undefined {
    if (typeof workspace === 'string') {
      return this.instance.tokens.get(workspace);
    }
    if (workspace instanceof Workspace) {
      return this.instance.tokens.get(workspace.name);
    }
    return undefined;
  }

  static cancel(workspaceUri: WorkspaceName): void;
  static cancel(workspace: Workspace): void;
  static cancel(workspace: Workspace | WorkspaceName): void {
    if (typeof workspace === 'string') {
      const token = this.instance.tokens.get(workspace);
      if (token) {
        token.done();
        this.instance.tokens.delete(workspace);
      }
    } else if (workspace instanceof Workspace) {
      const token = this.instance.tokens.get(workspace.uri);
      if (token) {
        token.done();
        this.instance.tokens.delete(workspace.uri);
      }
    }
  }

  static add(workspace: WorkspaceName, token: ProgressWrapper): void;
  static add(workspace: Workspace, token: ProgressWrapper): void;
  static add(workspace: Workspace | WorkspaceName, token: ProgressWrapper): void {
    if (typeof workspace === 'string') {
      this.instance.tokens.set(workspace, token);
      return;
    }
    this.instance.tokens.set(workspace.name, token);
  }

  static delete(workspaceUri: WorkspaceName): void;
  static delete(workspace: Workspace): void;
  static delete(workspace: Workspace | WorkspaceName): void {
    if (typeof workspace === 'string') {
      this.instance.tokens.delete(workspace);
      return;
    }
    this.instance.tokens.delete(workspace.name);
  }

  static cancelAll(): void {
    this.instance.tokens.forEach((token) => {
      token.done();
    });
    this.instance.tokens.clear();
  }
}
ProgressTokens.initialize();

