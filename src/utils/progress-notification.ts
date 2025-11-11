import { connection } from './startup';
import { config } from '../config';
import { WorkDoneProgressReporter } from 'vscode-languageserver';
import { logger } from '../logger';

export class ProgressNotification implements WorkDoneProgressReporter {
  private reporter: WorkDoneProgressReporter | null = null;

  private constructor() {
    this.reporter = null;
  }

  public static isSupported(): boolean {
    return !!config.fish_lsp_show_client_popups;
  }

  public static async create(): Promise<ProgressNotification> {
    const progress = new ProgressNotification();
    logger.debug(`SHOULD CREATE \`progress\` NOTIFICATION: ${ProgressNotification.isSupported()}`);
    if (ProgressNotification.isSupported()) {
      logger.debug('CREATED \`progress\` NOTIFICATION');
      progress.reporter = await connection.window.createWorkDoneProgress();
    } else {
      logger.debug('SKIPPING CREATION OF \`progress\` NOTIFICATION');
    }
    return progress;
  }

  public begin(title: string, percentage?: number, message?: string, cancellable?: boolean): void;
  public begin(title: string = '[fish-lsp] analysis', percentage?: number, message?: string, cancellable?: boolean): void {
    if (this.reporter) {
      this.reporter.begin(title, percentage, message, cancellable);
    }
  }

  public report(percentage: number): void;
  public report(message: string): void;
  public report(percentage: number, message: string): void;
  public report(arg0: string | number, message?: string): void {
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
    if (this.reporter) {
      this.reporter.done();
    }
  }
}

