import * as console from 'node:console';
import fs from 'fs';
import { config } from './config';

export interface IConsole {
  error(...args: any[]): void;
  warn(...args: any[]): void;
  info(...args: any[]): void;
  log(...args: any[]): void;
  debug(...args: any[]): void;
}

export const LOG_LEVELS = ['debug', 'info', 'warning', 'error'] as const;
export const DEFAULT_LOG_LEVEL: LogLevel = 'info';

export type LogLevel = typeof LOG_LEVELS[number];

const _logLevel: LogLevel = DEFAULT_LOG_LEVEL;

function getLogLevel(level: string): LogLevel {
  if (LOG_LEVELS.includes(level as LogLevel)) {
    return level as LogLevel;
  }
  return DEFAULT_LOG_LEVEL;
}

export class Logger {
  protected _console: IConsole;
  /** never print to console */
  protected _silence: boolean = true;
  /** reformat every log message as json */
  protected _onlyJson: boolean = true;
  protected logFilePath: string;
  private started = false;

  constructor(logFilePath: string = '', clear: boolean = true, _console: IConsole = console) {
    this.logFilePath = logFilePath;
    this._console = _console;
    if (clear && this.hasLogFile()) {
      this.clearLogFile();
    }
  }

  isStarted(): boolean {
    return this.started;
  }

  start(): void {
    this.started = true;
  }

  toggleSilence() {
    this._silence = !this._silence;
  }

  toggleJson() {
    this._onlyJson = !this._onlyJson;
  }

  hasSilence() {
    return this._silence;
  }

  hasLogFile(): boolean {
    return this.logFilePath !== '';
  }

  clearLogFile(): void {
    if (this.hasLogFile()) {
      try {
        // fs.truncateSync(this.logFilePath, 0);
        fs.writeFileSync(this.logFilePath, '');
      } catch (error) {
        this._console.error(`Error clearing log file: ${error}`);
      }
    }
  }

  private logToFile(message: string): void {
    if (this.hasLogFile()) {
      fs.appendFileSync(this.logFilePath, message + '\n', 'utf-8');
    }
  }

  log(...args: any[]): void {
    const formattedMessage = this.convertArgsToString(...args);
    if (config.fish_lsp_log_level === '') {
      this._log(formattedMessage);
      return;
    }
    const level = getLogLevel(config.fish_lsp_log_level);
    this._logWithSeverity(level, formattedMessage);
  }

  private _logWithSeverity(severity: LogLevel, ...args: string[]): void {
    if (_logLevel < severity) return;
    const formattedMessage = this.convertArgsToString(...args);
    if (!this.hasSilence()) this._console.log(severity, formattedMessage);
    if (this.hasLogFile()) this.logToFile([severity, formattedMessage].join(' '));
  }

  private convertArgsToString(...args: any[]): string {
    const formattedMessage = args.map((arg) => {
      if (arg instanceof Error) {
        return arg.stack || arg.message;
      }
      if (typeof arg === 'object') {
        return JSON.stringify(arg, null, 2);
      }
      return String(arg);
    }).join('\n');
    return formattedMessage;
  }

  private _log(...args: string[]): void {
    if (!this.hasSilence()) this._console.log(...args);
    if (this.hasLogFile()) this.logToFile(args.join(' '));
  }

  logAsJson(message: string) {
    this.logToFile(JSON.stringify({
      date: new Date().toLocaleString(),
      message: message,
    }));
  }

  logPropertiesForEachObject<T extends Record<string, any>>(objs: T[], ...keys: (keyof T)[]): void {
    objs.forEach((obj, i) => {
      // const selectedKeys = keys.filter(key => obj.hasOwnProperty(key));
      const selectedKeys = keys.filter(key => Object.prototype.hasOwnProperty.bind(obj, key));
      const selectedObj = selectedKeys.reduce((acc, key) => {
        acc[key] = obj[key];
        return acc;
      }, {} as Partial<T>);

      const formattedMessage = `${i}: ${JSON.stringify(selectedObj, null, 2)}`;

      this._console.log(formattedMessage);
      this.logToFile(formattedMessage);
    });
  }

  showLogfileText(): void {
    if (!this.hasLogFile()) {
      this._console.log('No log file specified');
    }
    this._console.log('--- Log file name ---');
    this._console.log(this.logFilePath);
    this._console.log('--- Log file text ---');
    this._console.log(fs.readFileSync(this.logFilePath, 'utf-8'));
  }

  getLoggingOpts() {
    return {
      logFile: this.hasLogFile(),
      silence: this.hasSilence(),
    };
  }

  public debug(...args: any[]): void {
    this._logWithSeverity('debug', ...args);
  }

  public info(...args: any[]): void {
    this._logWithSeverity('info', ...args);
  }

  public warning(...args: any[]): void {
    this._logWithSeverity('warning', ...args);
  }

  public error(...args: any[]): void {
    this._logWithSeverity('error', ...args);
  }
}

export class JestLogger extends Logger {
  private _jestConsole = console;
  private _globalConsole = global.console;

  constructor() {
    super('', false, console);
  }
  beforeEachTest(): void {
    global.console = this._globalConsole;
  }
  afterEachTest(): void {
    global.console = this._jestConsole;
  }
}

export let logger: Logger = new Logger();

export function createServerLogger(logFilePath: string, clear: boolean = true, connectionConsole?: IConsole, forceRestart: boolean = false): Logger {
  if (!logger.isStarted() || forceRestart) {
    logger = new Logger(logFilePath, clear, connectionConsole);
    logger.start();
  }
  return logger;
}

export function createJestLogger(): JestLogger {
  return new JestLogger();
}

export function logToStdout(message: string, newline = true): void {
  const output: string = `${message}${!!newline && '\n'}`;
  process.stdout.write(output);
}

/** util for joining multiple strings and logging to stdout with trailing `\n` */
export function logToStdoutJoined(...message: string[]) {
  const output: string = `${message.join('')}\n`;
  process.stdout.write(output);
}

/**
 * A helper function to wrap default logging behavior for the logger, if it is started.
 *   - If logger is started, log to logger     `logger.log()`
 *   - If logger is not started, log to stdout `logToStdout()`
 *
 * @param args - any number of arguments to log
 * @returns void
 */
export function log(...args: any[]): void {
  if (logger.isStarted()) {
    logger.log(...args);
  } else {
    logToStdout(args.join(''), true);
  }
}
