// import * as LSP from 'vscode-languageserver';
// import * as fs from 'fs';
// import { Logger, setLogConsole, setLogConnection, setLogLevel, logToStdout } from '../src/logger';
//
// jest.mock('fs');
// jest.mock('vscode-languageserver');
//
// describe('Logger', () => {
//   let mockConsole: Console;
//   let mockConnection: LSP.Connection;
//   let logger: Logger;
//
//   beforeEach(() => {
//     mockConsole = {
//       log: jest.fn(),
//       info: jest.fn(),
//       warn: jest.fn(),
//       error: jest.fn(),
//     } as unknown as Console;
//
//     mockConnection = {
//       console: mockConsole,
//       sendNotification: jest.fn(),
//     } as unknown as LSP.Connection;
//
//     logger = new Logger({ prefix: 'TEST' });
//     setLogConnection(mockConnection);
//   });
//
//   afterEach(() => {
//     jest.clearAllMocks();
//   });
//
//   test('log method with multiple arguments', () => {
//     logger.log(LSP.MessageType.Info, 'Test message', JSON.stringify({ key: 'value' }))
//     expect(mockConsole.info).toHaveBeenCalledWith('TEST Test message {"key":"value"}');
//   });
//
//   test('sendNotification method with multiple arguments', () => {
//     setLogConnection(mockConnection);
//     logger.sendNotification(LSP.MessageType.Warning, 'Warning message', 123, JSON.stringify([1, 2, 3]));
//     expect(mockConnection.sendNotification).toHaveBeenCalledWith('2', {
//       type: LSP.MessageType.Warning,
//       message: 'TEST Warning message 123 [1,2,3]',
//     });
//   });
//
//   test('log to file', () => {
//     const mockAppendFileSync = jest.spyOn(fs, 'appendFileSync');
//     logger.setLogFile('test.log');
//     logger.log(LSP.MessageType.Log, 'File log test');
//     expect(mockAppendFileSync).toHaveBeenCalledWith('test.log', 'File log test\n', 'utf-8');
//   });
//
//   test('setLogLevel', () => {
//     setLogLevel('warning');
//     logger.log(LSP.MessageType.Info, 'This should not be logged');
//     expect(mockConsole.info).not.toHaveBeenCalled();
//
//     logger.log(LSP.MessageType.Warning, 'This should be logged');
//     expect(mockConsole.warn).toHaveBeenCalled();
//   });
//
//   test('logToStdout', () => {
//     const mockStdoutWrite = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
//     
//     logToStdout('Test stdout', true);
//     expect(mockStdoutWrite).toHaveBeenCalledWith('Test stdout\n');
//
//     logToStdout('Test stdout', false);
//     expect(mockStdoutWrite).toHaveBeenCalledWith('Test stdout');
//
//     mockStdoutWrite.mockRestore();
//   });
// });
import * as LSP from 'vscode-languageserver';
import { Logger, setLogConsole, setLogLevel } from '../src/logger';
describe('Logger Filtering', () => {
  let logger: Logger;
  let consoleLogSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleInfoSpy: jest.SpyInstance;

  beforeEach(() => {
    logger = new Logger({ prefix: 'TEST' });
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();
    setLogLevel('log'); // Reset log level before each test
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Log Level Filtering', () => {
    test('should not log messages below set log level', () => {
      setLogLevel('warning');
      logger.log(LSP.MessageType.Info, 'Info message');
      logger.log(LSP.MessageType.Log, 'Log message');
      expect(consoleInfoSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    test('should log messages at or above set log level', () => {
      setLogLevel('warning');
      logger.log(LSP.MessageType.Warning, 'Warning message');
      logger.log(LSP.MessageType.Error, 'Error message');
      expect(consoleWarnSpy).toHaveBeenCalledWith('TEST Warning message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('TEST Error message');
    });

    test('should set log level to Log for invalid input', () => {
      setLogLevel('invalid');
      logger.log(LSP.MessageType.Log, 'Log message');
      expect(consoleLogSpy).toHaveBeenCalledWith('TEST Log message');
    });

    test('should log all message types when log level is set to log', () => {
      setLogLevel('log');
      logger.log(LSP.MessageType.Log, 'Log message');
      logger.log(LSP.MessageType.Info, 'Info message');
      logger.log(LSP.MessageType.Warning, 'Warning message');
      logger.log(LSP.MessageType.Error, 'Error message');
      expect(consoleLogSpy).toHaveBeenCalledWith('TEST Log message');
      expect(consoleInfoSpy).toHaveBeenCalledWith('TEST Info message');
      expect(consoleWarnSpy).toHaveBeenCalledWith('TEST Warning message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('TEST Error message');
    });
  });
});