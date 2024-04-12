import {
  CompletionItem,
  Connection,
  DocumentSymbol,
  Hover,
  Position,
  RemoteConsole,
  SymbolKind,
  Range,
  ExecuteCommandParams,
} from 'vscode-languageserver';
import * as console from 'node:console';
//import {TextDocument} from 'vscode-languageserver-textdocument';
//import {URI} from 'vscode-uri';
//import { SyntaxNode } from "web-tree-sitter";
//import {FishCompletionItem, FishCompletionItemKind} from './utils/completion-strategy';
//import {resolve} from 'path';
//import { appendFileSync } from 'fs';
//
//
//export interface LogOptions {
//    caller?: string;
//    message?: string;
//    extraInfo?: string | string[];
//    verticalPad?: boolean;
//    error?: boolean;
//    executableFile?: string;
//    path?: string;
//    uri?: URI;
//    rootNode?: SyntaxNode;
//    nodes?: SyntaxNode[];
//    position?: Position;
//    hover?: Hover;
//    completion?: CompletionItem;
//    document?: TextDocument;
//    debugLogger?: boolean;
//}

//export class Logger {
//private static instance : Logger;

//private LOGFILE: string = resolve('/home/ndonfris/repos/fish-lang-server/logs.txt')

import fs from 'fs';
import { resolve } from 'path';

export interface IConsole {
  error(...args: any[]): void;
  warn(...args: any[]): void;
  info(...args: any[]): void;
  log(...args: any[]): void;
}
type ConsoleMethod = 'error' | 'warn' | 'info' | 'log';
type CConsole = Console;

export class Logger {
  protected _console: IConsole;
  protected logFilePath: string;

  constructor(logFilePath: string = '', clear: boolean = true, _console: IConsole = console) {
    this.logFilePath = logFilePath;
    this._console = _console;
    if (clear && this.hasLogFile()) {
      this.clearLogFile();
    }
  }

  hasLogFile(): boolean {
    return this.logFilePath !== '';
  }

  private clearLogFile(): void {
    try {
      // fs.truncateSync(this.logFilePath, 0);
      fs.writeFileSync(this.logFilePath, '')
    } catch (error) {
      this._console.error(`Error clearing log file: ${error}`);
    }
  }

  private logToFile(message: string): void {
    fs.appendFileSync(this.logFilePath, message + '\n', 'utf-8');
  }

  log(...args: any[]): void {
    const formattedMessage = args.map((arg) => {
      if (arg instanceof Error) {
        return arg.stack || arg.message;
      }
      if (typeof arg === 'object') {
        return JSON.stringify(arg, null, 2);
      }
      return String(arg);
    }).join('\n');

    this._console.log(formattedMessage);
    if (this.hasLogFile()) {
      this.logToFile(formattedMessage);
    }
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

export const ServerLogsPath = resolve(
  __dirname,
  '..',
  'logs.txt',
);

export function createServerLogger(logFilePath: string = '', clear: boolean = true): Logger {
  return new Logger(logFilePath, clear);
}

export function createJestLogger(): JestLogger {
  return new JestLogger();
}
