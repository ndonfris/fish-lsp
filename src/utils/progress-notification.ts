import { connection } from './startup';
import { config } from '../config';
import { WorkDoneProgressReporter } from 'vscode-languageserver';
import { logger } from '../logger';

type ProgressAction =
  | { kind: 'begin'; title: string; percentage?: number; message?: string; cancellable?: boolean; timestamp: number; }
  | { kind: 'report'; percentage?: number; message?: string; timestamp: number; }
  | { kind: 'end'; timestamp: number; };

/**
 * Simplified progress notification wrapper that only shows progress
 * when the config allows it. Used for long-running operations like
 * workspace analysis.
 */
export class ProgressNotification implements WorkDoneProgressReporter {
  private token: string;
  private static instanceCounter = 0;
  private instanceId: number;
  private caller: string = 'unknown';
  private isReady: boolean = false;
  private queue: ProgressAction[] = [];

  private constructor(token: string) {
    this.token = token;
    this.instanceId = ++ProgressNotification.instanceCounter;
  }

  public static isSupported(): boolean {
    return !!config.fish_lsp_show_client_popups;
  }

  /**
   * Create a progress notification if supported by config
   */
  public static async create(caller?: string): Promise<ProgressNotification> {
    const token = `fish-lsp-${caller || 'progress'}-${Date.now()}`;
    const progress = new ProgressNotification(token);
    progress.caller = caller || 'unknown';
    const stack = new Error().stack?.split('\n')[2]?.trim() || 'unknown';
    logger.debug(`[PROGRESS-${progress.instanceId}] CREATE from ${progress.caller} | ${stack}`);
    logger.debug(`SHOULD CREATE \`progress\` NOTIFICATION: ${ProgressNotification.isSupported()}`);

    if (ProgressNotification.isSupported()) {
      const startTime = performance.now();
      try {
        await connection.sendRequest('window/workDoneProgress/create', { token });
        const elapsed = performance.now() - startTime;
        progress.isReady = true;
        logger.debug(`[PROGRESS-${progress.instanceId}] CREATED \`progress\` NOTIFICATION with token: ${token} (took ${elapsed.toFixed(2)}ms)`);
        progress.flushQueue();
      } catch (error) {
        const elapsed = performance.now() - startTime;
        logger.warning(`[PROGRESS-${progress.instanceId}] Failed to create progress reporter after ${elapsed.toFixed(2)}ms`, { error });
        progress.queue = []; // Clear queue on error
      }
    } else {
      logger.debug(`[PROGRESS-${progress.instanceId}] SKIPPING CREATION OF \`progress\` NOTIFICATION`);
    }
    return progress;
  }

  private sendNotification(value: ProgressAction): void {
    connection.sendNotification('$/progress', {
      token: this.token,
      value,
    });
  }

  private flushQueue(): void {
    if (!this.isReady || this.queue.length === 0) return;

    const now = performance.now();
    logger.debug(`[PROGRESS-${this.instanceId}] Flushing ${this.queue.length} queued actions`);
    const actions = [...this.queue];
    this.queue = [];

    for (const action of actions) {
      const delay = now - action.timestamp;
      if (delay > 10) {
        logger.debug(`[PROGRESS-${this.instanceId}] Action '${action.kind}' delayed by ${delay.toFixed(2)}ms`);
      }
      this.sendNotification(action);
    }
  }

  private enqueue(action: ProgressAction): void {
    if (!ProgressNotification.isSupported()) return;

    if (this.isReady) {
      this.sendNotification(action);
    } else {
      this.queue.push(action);
    }
  }

  public begin(title: string, percentage?: number, message?: string, cancellable?: boolean): void;
  public begin(title: string = '[fish-lsp] analysis', percentage?: number, message?: string, cancellable?: boolean): void {
    logger.info(`[PROGRESS-${this.instanceId}] BEGIN from ${this.caller}: "${title}" (${percentage}%, msg: "${message}")`);
    this.enqueue({ kind: 'begin', title, percentage, message, cancellable, timestamp: performance.now() });
  }

  public report(percentage: number): void;
  public report(message: string): void;
  public report(percentage: number, message: string): void;
  public report(arg0: string | number, message?: string): void {
    logger.info(`[PROGRESS-${this.instanceId}] REPORT from ${this.caller}: ${JSON.stringify({ arg0, message })}`);

    const action: ProgressAction = { kind: 'report', timestamp: performance.now() };
    if (typeof arg0 === 'number') {
      action.percentage = arg0;
      if (message) action.message = message;
    } else if (typeof arg0 === 'string') {
      action.message = arg0;
    }

    this.enqueue(action);
  }

  public done(): void {
    logger.info(`[PROGRESS-${this.instanceId}] DONE from ${this.caller}`);
    this.enqueue({ kind: 'end', timestamp: performance.now() });
  }
}
