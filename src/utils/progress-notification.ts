import { connection } from './startup';
import { config } from '../config';
import { WorkDoneProgressReporter } from 'vscode-languageserver';
import { logger } from '../logger';

/**
 * Simplified progress notification wrapper that only shows progress
 * when the config allows it. Used for long-running operations like
 * workspace analysis.
 */
export class ProgressNotification implements WorkDoneProgressReporter {
  private reporter: WorkDoneProgressReporter | null = null;
  private static instanceCounter = 0;
  private instanceId: number;
  private caller: string = 'unknown';

  private constructor() {
    this.reporter = null;
    this.instanceId = ++ProgressNotification.instanceCounter;
  }

  public static isSupported(): boolean {
    return !!config.fish_lsp_show_client_popups;
  }

  public isReporterAvailable(): boolean {
    return this.reporter !== null;
  }

  /**
   * Create a progress notification if supported by config
   */
  public static async create(caller?: string): Promise<ProgressNotification> {
    const progress = new ProgressNotification();
    progress.caller = caller || 'unknown';
    const stack = new Error().stack?.split('\n')[2]?.trim() || 'unknown';
    logger.debug(`[PROGRESS-${progress.instanceId}] CREATE from ${progress.caller} | ${stack}`);
    logger.debug(`SHOULD CREATE \`progress\` NOTIFICATION: ${ProgressNotification.isSupported()}`);
    if (ProgressNotification.isSupported()) {
      logger.debug(`[PROGRESS-${progress.instanceId}] CREATED \`progress\` NOTIFICATION`);
      progress.reporter = await connection.window.createWorkDoneProgress();
    } else {
      logger.debug(`[PROGRESS-${progress.instanceId}] SKIPPING CREATION OF \`progress\` NOTIFICATION`);
    }
    return progress;
  }

  public begin(title: string, percentage?: number, message?: string, cancellable?: boolean): void;
  public begin(title: string = '[fish-lsp] analysis', percentage?: number, message?: string, cancellable?: boolean): void {
    logger.info(`[PROGRESS-${this.instanceId}] BEGIN from ${this.caller}: "${title}" (${percentage}%, msg: "${message}")`);
    if (this.reporter) {
      this.reporter.begin(title, percentage, message, cancellable);
    }
  }

  public report(percentage: number): void;
  public report(message: string): void;
  public report(percentage: number, message: string): void;
  public report(arg0: string | number, message?: string): void {
    logger.info(`[PROGRESS-${this.instanceId}] REPORT from ${this.caller}: ${JSON.stringify({ arg0, message })}`);
    if (this.reporter) {
      if (typeof arg0 === 'number' && message === undefined) {
        this.reporter.report(arg0);
      } else if (typeof arg0 === 'string' && message === undefined) {
        this.reporter.report(arg0);
      } else if (typeof arg0 === 'number' && message !== undefined) {
        this.reporter.report(arg0, message);
      }
    }
  }

  public done(): void {
    logger.info(`[PROGRESS-${this.instanceId}] DONE from ${this.caller}`);
    if (this.reporter) {
      this.reporter.done();
    }
  }
}
