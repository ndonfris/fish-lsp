import * as fs from 'fs';
import { vi } from 'vitest';
import { setLogger, fail } from './helpers';
import { logger, createServerLogger, Logger } from '../src/logger';
import * as LSP from 'vscode-languageserver';
import { createConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-languageserver/node';

let connection: LSP.Connection = createConnection(
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout),
);

export function loggerIsDefined(_logger: Logger | undefined): _logger is Logger {
  return _logger !== null;
}

const logFilePath = '/tmp/fish-lsp-test.log';
describe('logger test suite', () => {
  const originalConsole = console;

  beforeEach(() => {
    global.console = require('console');
  });

  afterEach(() => {
    global.console = originalConsole;
  });

  describe('logger default behavior', () => {
    beforeEach(() => {
      logger.allowDefaultConsole().setConsole(global.console).start();
    });
    it('logger should log to console', () => {
      if (!loggerIsDefined(logger)) fail();
      logger.log('test log');
    });

    it('debug should log to console', () => {
      if (!loggerIsDefined(logger)) fail();
      logger.debug('test debug');
    });

    it('info should log to console', () => {
      if (!loggerIsDefined(logger)) fail();
      logger.info('test info');
    });

    it('warning should log to console', () => {
      if (!loggerIsDefined(logger)) fail();
      logger.warning('test warning');
    });

    it('error should log to console', () => {
      if (!loggerIsDefined(logger)) fail();
      logger.error('test error');
    });

    it('logToStdout should log to stdout', () => {
      if (!loggerIsDefined(logger)) fail();
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      logger.logToStdout('test log to stdout');
      expect(spy).toHaveBeenCalledWith('test log to stdout\n');
      spy.mockRestore();
    });

    it('logToStderr should log to stderr', () => {
      if (!loggerIsDefined(logger)) fail();
      const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      logger.logToStderr('test log to stderr');
      expect(spy).toHaveBeenCalledWith('test log to stderr\n');
      spy.mockRestore();
    });

    it('logAsJson', () => {
      if (!loggerIsDefined(logger)) fail();
      logger.logAsJson('test log as json', { key: 'value' });
    });
  });

  describe('server usage', () => {
    setLogger();
    let testLogger: Logger | undefined;
    beforeEach(() => {
      connection = createConnection(
        new StreamMessageReader(process.stdin),
        new StreamMessageWriter(process.stdout),
      );
      fs.writeFileSync(logFilePath, '');
      testLogger = new Logger()
        .setConnectionConsole(connection.console)
        .setLogFilePath(logFilePath)
        .setSilent(true)
        .setClear(true)
        .start();
    });

    afterEach(() => {
      if (fs.existsSync(logFilePath)) {
        fs.rmSync(logFilePath);
      }
    });

    afterAll(() => {
      testLogger = undefined;
    });

    it('should create server logger', () => {
      if (!loggerIsDefined(testLogger)) fail();
      testLogger = createServerLogger('', connection.console);
      expect(testLogger).toBeInstanceOf(Logger);
      expect(testLogger.isStarted()).toBe(true);
    });

    it('should create server logger and log to file', () => {
      if (!loggerIsDefined(testLogger)) fail();
      console.log({
        logFilePath: testLogger.logFilePath,
        isStarted: testLogger.isStarted(),
        hasLogFile: testLogger.hasLogFile(),
        hasConsole: testLogger.hasConsole(),
        isSilent: testLogger.isSilent(),
      });
      // console.log({output});
      expect(testLogger.logFilePath).toBe(logFilePath);
      expect(testLogger.isStarted()).toBe(true);
      expect(testLogger.isConnected()).toBe(true);
      expect(testLogger.hasLogFile()).toBe(true);
      expect(testLogger.hasConsole()).toBe(true);
      expect(testLogger.isSilent()).toBe(true);
      testLogger.log('test log to file');
      testLogger.error('error message');
      const output = fs.readFileSync(logFilePath, 'utf-8');
      expect(output).toEqual('test log to file\nERROR: error message\n');
    });

    it('should log to file and not to console', () => {
      if (!loggerIsDefined(testLogger)) fail();
      testLogger = new Logger()
        .setLogFilePath(logFilePath)
        .setConnectionConsole(connection.console)
        .setSilent(true)
        .start();

      testLogger.log('test log to file');
      testLogger.error('error message');
      testLogger.warning('warning message');
      testLogger.info('info message');
      testLogger.debug('debug message');
      const output = fs.readFileSync(logFilePath, 'utf-8');
      // console.log({ output });
      expect(output).toEqual([
        'test log to file\n',
        'ERROR: error message\n',
        'WARNING: warning message\n',
        'INFO: info message\n',
        'DEBUG: debug message\n',
      ].join(''));
    });

    it('logging before file is set', () => {
      if (!loggerIsDefined(testLogger)) fail();
      testLogger = new Logger().setConnectionConsole(connection.console).setSilent(true);
      testLogger.log('test log to file');
      testLogger.error('error message');
      testLogger.warning('warning message');
      testLogger.info('info message');
      testLogger.debug('debug message');
      testLogger.setLogFilePath(logFilePath);
      testLogger.start();
      const output = fs.readFileSync(logFilePath, 'utf-8');
      console.log({ output });
      expect(output).toEqual([
        'test log to file\n',
        'ERROR: error message\n',
        'WARNING: warning message\n',
        'INFO: info message\n',
        'DEBUG: debug message\n',
      ].join(''));
    });

    it('severity ERROR', () => {
      if (!loggerIsDefined(testLogger)) fail();
      testLogger = new Logger()
        .setLogFilePath(logFilePath)
        .setConnectionConsole(connection.console)
        .setSilent(true)
        .setLogLevel('error')
        .start();

      testLogger.log('test log to file');
      testLogger.error('error message');
      testLogger.warning('warning message');
      testLogger.info('info message');
      testLogger.debug('debug message');
      const output = fs.readFileSync(logFilePath, 'utf-8');
      console.log({ output });
      expect(output).toEqual([
        'ERROR: error message\n',
      ].join(''));
    });

    it('severity WARNING', () => {
      if (!loggerIsDefined(testLogger)) fail();
      testLogger = new Logger()
        .setLogFilePath(logFilePath)
        .setConnectionConsole(connection.console)
        .setSilent(true)
        .setLogLevel('warning')
        .start();

      testLogger.log('test log to file');
      testLogger.error('error message');
      testLogger.warning('warning message');
      testLogger.info('info message');
      testLogger.debug('debug message');
      const output = fs.readFileSync(logFilePath, 'utf-8');
      console.log('severity warning', { output });
      expect(output).toEqual([
        'ERROR: error message\n',
        'WARNING: warning message\n',
      ].join(''));
    });
  });

  describe('stdout', () => {
    let testLogger: Logger | undefined;
    beforeEach(() => {
      testLogger = new Logger().setConsole(global.console).allowDefaultConsole().start();
    });

    it('should log to stdout', () => {
      if (!loggerIsDefined(testLogger)) fail();
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      testLogger.logToStdout('test log to stdout');
      expect(spy).toHaveBeenCalledWith('test log to stdout\n');
      spy.mockRestore();
    });

    it('should log to stdout with newline', () => {
      if (!loggerIsDefined(testLogger)) fail();
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      testLogger.logToStdout('test log to stdout', false);
      expect(spy).toHaveBeenCalledWith('test log to stdout');
      spy.mockRestore();
    });

    it('should log to stdout joined', () => {
      if (!loggerIsDefined(testLogger)) fail();
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      testLogger.logToStdoutJoined('test log to stdout', ' joined');
      expect(spy).toHaveBeenCalledWith('test log to stdout joined\n');
      spy.mockRestore();
    });
  });
});
