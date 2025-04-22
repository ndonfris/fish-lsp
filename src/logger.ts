import * as console from 'node:console';
import fs from 'fs';
import { config } from './config';

export interface IConsole {
  error(...args: any[]): void;
  warn(...args: any[]): void;
  info(...args: any[]): void;
  debug(...args: any[]): void;
  log(...args: any[]): void;
}

export const LOG_LEVELS = ['error', 'warning', 'info', 'debug', 'log', ''] as const;
export const DEFAULT_LOG_LEVEL: LogLevel = 'log';

export type LogLevel = typeof LOG_LEVELS[number];
export const LogLevel: Record<LogLevel, number> = {
  error: 1,
  warning: 2,
  info: 3,
  debug: 4,
  log: 5,
  '': 6,
};

function getLogLevel(level: string): LogLevel {
  if (LOG_LEVELS.includes(level as LogLevel)) {
    return level as LogLevel;
  }
  return DEFAULT_LOG_LEVEL;
}

export class Logger {
  /** The default console object */
  protected _console: IConsole = console;

  /** never print to console */
  private _silence: boolean = false;

  /** clear the log file once a log file has been set */
  private _clear: boolean = true;

  /** logs that were requested before a log file was set */
  private _logQueue: string[] = [];

  /** path to the log file */
  public logFilePath: string = '';

  /** set to true if the logger has been started */
  private started = false;

  /** set to true if the logger is connected to a server/client connection */
  private isConnectedToConnection = false;

  /** requires the server/client connection object to console.log() */
  private requiresConnectionConsole = true;

  /** set to true if the logger is connected to a server/client connection */
  private _logLevel: LogLevel = '';

  constructor(logFilePath: string = '') {
    this.logFilePath = logFilePath;
  }

  /**
   * Set the log file path
   */
  setLogFilePath(logFilePath: string): this {
    this.logFilePath = logFilePath;
    return this;
  }

  /**
   * Set the this._console to a connection.console and update the isConnectedToConnection property
   */
  setConnectionConsole(_console: IConsole | undefined): this {
    if (_console) {
      this._console = _console;
      this.isConnectedToConnection = true;
    }
    return this;
  }

  /**
   * Just set the console object, without changing the isConnectedToConnection property
   * This is useful for testing, with the requiresConnectionConsole property set to false
   */
  setConsole(_console: IConsole | undefined): this {
    if (_console) {
      this._console = _console;
    }
    return this;
  }

  setClear(clear: boolean = true): this {
    this._clear = clear;
    return this;
  }

  /**
   * Set the silence flag, so that console.log() will not be shown
   * This is used to make logging only appear in the log file.
   */
  setSilent(silence: boolean = true): this {
    this._silence = silence;
    return this;
  }

  /**
   * Set logLevel to a specific level
   */
  setLogLevel(level: string): this {
    const logLevel = getLogLevel(level);
    if (LOG_LEVELS.includes(logLevel)) {
      this._logLevel = logLevel;
    }
    return this;
  }

  /**
   * Allow using the default console object, instead of requiring the server to be connected to a server/client connection
   */
  allowDefaultConsole(): this {
    this.requiresConnectionConsole = false;
    return this;
  }

  isConnectionConsole(): boolean {
    return this.isConnectedToConnection;
  }

  isStarted(): boolean {
    return this.started;
  }

  isSilent(): boolean {
    return this._silence;
  }

  isClearing(): boolean {
    return this._clear;
  }

  isConnected(): boolean {
    return this.isConnectedToConnection && this.requiresConnectionConsole;
  }

  hasLogLevel(): boolean {
    return this._logLevel !== '';
  }

  hasConsole(): boolean {
    if (this.isConnectionConsole()) {
      return this.isConnected();
    }
    return this._console !== undefined;
  }

  start(): this {
    this.started = true;
    this.clearLogFile();
    this._logQueue.forEach((message) => {
      this._log(message);
    });
    return this;
  }

  hasLogFile(): boolean {
    return this.logFilePath !== '';
  }

  /**
   * Only clears the log file if this option has been enabled.
   */
  private clearLogFile(): void {
    if (this.isClearing() && this.hasLogFile()) {
      try {
        fs.writeFileSync(this.logFilePath, '');
      } catch (error) {
        this._console.error(`Error clearing log file: ${error}`);
      }
    }
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

  private _log(...args: any[]): void {
    if (!this.isSilent() && this.hasConsole()) this._console.log(...args);
    const formattedMessage = this.convertArgsToString(...args);
    if (this.hasLogFile()) {
      fs.appendFileSync(this.logFilePath, formattedMessage + '\n', 'utf-8');
    } else {
      this._logQueue.push(formattedMessage);
    }
  }

  public logAsJson(...args: any[]) {
    const formattedMessage = this.convertArgsToString(args);
    this._log({
      date: new Date().toLocaleString(),
      message: formattedMessage,
    });
  }

  private _logWithSeverity(severity: LogLevel, ...args: string[]): void {
    if (this.hasLogLevel() && LogLevel[this._logLevel] < LogLevel[severity]) {
      return;
    }
    const formattedMessage = [severity.toUpperCase() + ':', this.convertArgsToString(...args)].join(' ');
    this._log(formattedMessage);
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
      this._log(formattedMessage);
    });
  }

  public log(...args: any[]): void {
    const formattedMessage = this.convertArgsToString(...args);
    if (!this.hasLogLevel()) {
      this._log(formattedMessage);
      return;
    }
    this._logWithSeverity('log', formattedMessage);
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

  /**
   * Util for logging to stdout, with optional trailing newline.
   * Will not include any logs that are passed in to the logger.
   * @param message - the message to log
   * @param newline - whether to add a trailing newline
   */
  public logToStdout(message: string, newline = true): void {
    const newlineChar = newline ? '\n' : '';
    const output: string = `${message}${newlineChar}`;
    process.stdout.write(output);
  }

  /**
   * Util for joining multiple strings and logging to stdout with trailing `\n`
   * Will not include any logs that are passed in to the logger.
   */
  public logToStdoutJoined(...message: string[]): void {
    const output: string = `${message.join('')}\n`;
    process.stdout.write(output);
  }

  public logToStderr(message: string, newline = true): void {
    const output: string = `${message}${!!newline && '\n'}`;
    process.stderr.write(output);
  }

  /**
   * A helper function to wrap default logging behavior for the logger, if it is started.
   *   - If logger is started, log to logger     `logger.log()`
   *   - If logger is not started, log to stdout `logToStdout()`
   *
   * @param args - any number of arguments to log
   * @returns void
   */
  public logFallbackToStdout(...args: any[]): void {
    if (this.isStarted()) {
      this.log(...args);
    } else {
      this.logToStdout(JSON.stringify(args, null, 2), true);
    }
  }
}

export const logger: Logger = new Logger();

export function createServerLogger(logFilePath: string, connectionConsole?: IConsole): Logger {
  return logger
    .setLogFilePath(logFilePath)
    .setConnectionConsole(connectionConsole)
    .setSilent()
    .setLogLevel(config.fish_lsp_log_level as LogLevel)
    .start();
}
