import * as fs from 'fs';
import { setLogger } from './helpers';
import { logger as _logger, createServerLogger, Logger } from '../src/logger';
import * as LSP from 'vscode-languageserver';
import { createConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-languageserver/node';

let logger: Logger | undefined = new Logger().allowDefaultConsole();
let connection: LSP.Connection = createConnection(
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout),
);

export function loggerIsDefined(_logger: Logger | undefined): _logger is Logger {
  return _logger !== null;
}

const logFilePath = '/tmp/fish-lsp-test.log';
describe('logger test suite', () => {
  const jestConsole = console;

  beforeEach(() => {
    global.console = require('console');
  });

  afterEach(() => {
    global.console = jestConsole;
  });

  describe('logger default behavior', () => {
    beforeEach(() => {
      logger = new Logger().allowDefaultConsole().setConsole(global.console).start();
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
      const spy = jest.spyOn(process.stdout, 'write').mockImplementation();
      logger.logToStdout('test log to stdout');
      expect(spy).toHaveBeenCalledWith('test log to stdout\n');
      spy.mockRestore();
    });

    it('logToStderr should log to stderr', () => {
      if (!loggerIsDefined(logger)) fail();
      const spy = jest.spyOn(process.stderr, 'write').mockImplementation();
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
    beforeEach(() => {
      connection = createConnection(
        new StreamMessageReader(process.stdin),
        new StreamMessageWriter(process.stdout),
      );
      fs.writeFileSync(logFilePath, '');
      logger = new Logger()
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
      logger = undefined;
    });

    it('should create server logger', () => {
      if (!loggerIsDefined(logger)) fail();
      logger = createServerLogger('', connection.console);
      expect(logger).toBeInstanceOf(Logger);
      expect(logger.isStarted()).toBe(true);
    });

    it('should create server logger and log to file', () => {
      if (!loggerIsDefined(logger)) fail();
      console.log({
        logFilePath: logger.logFilePath,
        isStarted: logger.isStarted(),
        hasLogFile: logger.hasLogFile(),
        hasConsole: logger.hasConsole(),
        isSilent: logger.isSilent(),
      });
      // console.log({output});
      expect(logger.logFilePath).toBe(logFilePath);
      expect(logger.isStarted()).toBe(true);
      expect(logger.isConnected()).toBe(true);
      expect(logger.hasLogFile()).toBe(true);
      expect(logger.hasConsole()).toBe(true);
      expect(logger.isSilent()).toBe(true);
      logger.log('test log to file');
      logger.error('error message');
      const output = fs.readFileSync(logFilePath, 'utf-8');
      expect(output).toEqual('test log to file\nERROR: error message\n');
    });

    it('should log to file and not to console', () => {
      if (!loggerIsDefined(logger)) fail();
      logger = new Logger()
        .setLogFilePath(logFilePath)
        .setConnectionConsole(connection.console)
        .setSilent(true)
        .start();

      logger.log('test log to file');
      logger.error('error message');
      logger.warning('warning message');
      logger.info('info message');
      logger.debug('debug message');
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
      if (!loggerIsDefined(logger)) fail();
      logger = new Logger().setConnectionConsole(connection.console).setSilent(true);
      logger.log('test log to file');
      logger.error('error message');
      logger.warning('warning message');
      logger.info('info message');
      logger.debug('debug message');
      logger.setLogFilePath(logFilePath);
      logger.start();
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
      if (!loggerIsDefined(logger)) fail();
      logger = new Logger()
        .setLogFilePath(logFilePath)
        .setConnectionConsole(connection.console)
        .setSilent(true)
        .setLogLevel('error')
        .start();

      logger.log('test log to file');
      logger.error('error message');
      logger.warning('warning message');
      logger.info('info message');
      logger.debug('debug message');
      const output = fs.readFileSync(logFilePath, 'utf-8');
      console.log({ output });
      expect(output).toEqual([
        'ERROR: error message\n',
      ].join(''));
    });

    it('severity WARNING', () => {
      if (!loggerIsDefined(logger)) fail();
      logger = new Logger()
        .setLogFilePath(logFilePath)
        .setConnectionConsole(connection.console)
        .setSilent(true)
        .setLogLevel('warning')
        .start();

      logger.log('test log to file');
      logger.error('error message');
      logger.warning('warning message');
      logger.info('info message');
      logger.debug('debug message');
      const output = fs.readFileSync(logFilePath, 'utf-8');
      console.log('severity warning', { output });
      expect(output).toEqual([
        'ERROR: error message\n',
        'WARNING: warning message\n',
      ].join(''));
    });
  });

  describe('stdout', () => {
    beforeEach(() => {
      logger = new Logger().setConsole(global.console).allowDefaultConsole().start();
    });

    it('should log to stdout', () => {
      if (!loggerIsDefined(logger)) fail();
      const spy = jest.spyOn(process.stdout, 'write').mockImplementation();
      logger.logToStdout('test log to stdout');
      expect(spy).toHaveBeenCalledWith('test log to stdout\n');
      spy.mockRestore();
    });

    it('should log to stdout with newline', () => {
      if (!loggerIsDefined(logger)) fail();
      const spy = jest.spyOn(process.stdout, 'write').mockImplementation();
      logger.logToStdout('test log to stdout', false);
      expect(spy).toHaveBeenCalledWith('test log to stdout');
      spy.mockRestore();
    });

    it('should log to stdout joined', () => {
      if (!loggerIsDefined(logger)) fail();
      const spy = jest.spyOn(process.stdout, 'write').mockImplementation();
      logger.logToStdoutJoined('test log to stdout', ' joined');
      expect(spy).toHaveBeenCalledWith('test log to stdout joined\n');
      spy.mockRestore();
    });
  });
});
