import * as LSP from 'vscode-languageserver';
import { Connection, WorkDoneProgressReporter } from 'vscode-languageserver';
import { Workspace } from './workspace';

/**
 * Create the progress token for the workspace progress token.
 */
export namespace AnalyzeProgressToken {
  /**
   * Create the progress token for the workspace progress token.
   */
  export async function create(
    connection: Connection,
    opts: { workspace: Workspace; } | { title: string; message: string; },
  ): Promise<ProgressWrapper> {
    const progress = await connection.window.createWorkDoneProgress();
    // const workspaceMaxSize = Math.min(workspace.paths.length, config.fish_lsp_max_background_files);
    const progressWrapper = new ProgressWrapper(progress, connection);

    if ('workspace' in opts) {
      const workspace = opts.workspace;
      progressWrapper.begin(workspace.name, 0, `analyzing ${workspace.name}`);
      return progressWrapper;
    }
    const { title, message } = opts;
    progressWrapper.begin(title, 0, message);
    return progressWrapper;
  }

  /**
   * Create the callback function for the workspace progress token.
   */
  export function callbackfn(
    connection: Connection,
  ) {
    return async function(opts: {workspace: Workspace;} | { title: string; message: string; }): Promise<ProgressWrapper> {
      return await create(connection, opts);
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
  private current: number = 0;
  constructor(
    public _progress: LSP.WorkDoneProgressServerReporter,
    private connection: LSP.Connection,
    // private workspace: Workspace,
  ) { }

  begin(title: string, percentage?: number, message?: string, cancellable?: boolean): void {
    this.status = 'inProgress';
    this._progress.begin(`[fish-lsp] ${title}`, percentage, message, cancellable);
    this.current = percentage || 0;
  }

  report(percentage: number): void;
  report(message: string): void;
  report(percentage: number, message: string): void; // Add this third overload
  report(percentageOrString: number | string, message?: string): void {
    let shouldReport = false;
    if (typeof percentageOrString === 'number') {
      if (percentageOrString > this.current) {
        this.current = percentageOrString;
        shouldReport = true;
      }
    } else if (typeof percentageOrString === 'string') {
      shouldReport = true;
    }

    if (!shouldReport) return;

    // const WorkDoneProgressReporterImpl = this._progress.constructor as Record<string, any>;
    // if (WorkDoneProgressReporterImpl && WorkDoneProgressReporterImpl.Instances instanceof Map && ('_token' in this._progress && (typeof this._progress._token === 'number' || typeof this._progress._token === 'string'))) {
    //   this.connection.sendProgress(LSP.WorkDoneProgress.type, this._progress._token, {
    //     kind: 'report',
    //     percentage: this.current,
    //     message: 'Analysis',
    //   });
    // }

    if (typeof percentageOrString === 'number' && typeof message === 'string') {
      this._progress.report(this.current, message);
    } else if (typeof percentageOrString === 'number') {
      this._progress.report(this.current);
    } else if (typeof percentageOrString === 'string') {
      this._progress.report(percentageOrString);
    }
  }

  done(): void {
    if (this.status === 'finished' || this.status === 'created') {
      return;
    }
    this.status = 'finished';
    this._progress.report(100, 'Completed');
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
