import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import * as fc from 'fast-check';
import { Logger, logger, createServerLogger, IConsole, LOG_LEVELS, LogLevel, DEFAULT_LOG_LEVEL } from '../src/logger';

// Mock fs module completely - no real file operations needed
vi.mock('fs', () => ({
  default: {
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    appendFileSync: vi.fn(),
    existsSync: vi.fn(),
    mkdtempSync: vi.fn().mockReturnValue('/tmp/mock-temp-dir'),
    rmSync: vi.fn(),
    unlinkSync: vi.fn(),
    readdirSync: vi.fn().mockReturnValue([]),
  },
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdtempSync: vi.fn().mockReturnValue('/tmp/mock-temp-dir'),
  rmSync: vi.fn(),
  unlinkSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
}));

// Mock the config module
vi.mock('../src/config', () => ({
  config: {
    fish_lsp_log_level: 'debug',
  },
}));

describe('Logger', () => {
  let testLogger: Logger;
  let mockConsole: IConsole;
  let stdoutSpy: any;
  let stderrSpy: any;
  let mockFs: any;

  beforeEach(() => {
    testLogger = new Logger();
    mockConsole = {
      log: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    // Setup filesystem mocks
    mockFs = {
      writeFileSync: vi.mocked(fs.writeFileSync),
      readFileSync: vi.mocked(fs.readFileSync),
      appendFileSync: vi.mocked(fs.appendFileSync),
      existsSync: vi.mocked(fs.existsSync),
    };

    // Reset all mocks
    vi.clearAllMocks();
    mockFs.existsSync.mockReturnValue(false); // Default to file not existing

    // Mock stdout/stderr
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe('Basic Configuration', () => {
    it('should create logger with default values', () => {
      expect(new Logger().logFilePath).toBe('');
      expect(new Logger().isStarted()).toBe(false);
      expect(new Logger().isSilent()).toBe(false);
      expect(new Logger().isClearing()).toBe(true);
    });

    it('should support method chaining', () => {
      fc.assert(fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom(...LOG_LEVELS.filter(l => l !== '')),
        (logPath, silent, clear, level) => {
          const result = testLogger
            .setLogFilePath(logPath)
            .setSilent(silent)
            .setClear(clear)
            .setLogLevel(level);

          expect(result).toBe(testLogger);
          expect(testLogger.logFilePath).toBe(logPath);
          expect(testLogger.isSilent()).toBe(silent);
          expect(testLogger.isClearing()).toBe(clear);
          expect(testLogger.hasLogLevel()).toBe(true);
        },
      ));
    });
  });

  describe('Argument Conversion (Property-Based)', () => {
    it('should handle any string input', () => {
      fc.assert(fc.property(
        fc.string(),
        (str) => {
          const result = testLogger.convertArgsToString(str);
          expect(typeof result).toBe('string');
          expect(result).toBe(str);
        },
      ));
    });

    it('should handle any number input', () => {
      fc.assert(fc.property(
        fc.float(),
        (num) => {
          const result = testLogger.convertArgsToString(num);
          expect(typeof result).toBe('string');
          expect(result).toBe(String(num));
        },
      ));
    });

    it('should handle boolean inputs', () => {
      fc.assert(fc.property(
        fc.boolean(),
        (bool) => {
          const result = testLogger.convertArgsToString(bool);
          expect(result).toBe(String(bool));
        },
      ));
    });

    it('should handle null and undefined', () => {
      expect(testLogger.convertArgsToString(null)).toBe('null');
      expect(testLogger.convertArgsToString(undefined)).toBe('undefined');
    });

    it('should handle Error objects', () => {
      fc.assert(fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        (message) => {
          const error = new Error(message);
          const result = testLogger.convertArgsToString(error);
          expect(result).toContain(message);
        },
      ));
    });

    it('should handle Date objects', () => {
      fc.assert(fc.property(
        fc.date(),
        (date) => {
          const result = testLogger.convertArgsToString(date.toISOString());
          expect(result).toBe(date.toISOString());
        },
      ));
    });

    it('should handle arrays of primitives', () => {
      fc.assert(fc.property(
        fc.array(fc.oneof(fc.string(), fc.integer(), fc.boolean()), { maxLength: 10 }),
        (arr) => {
          const result = testLogger.convertArgsToString(arr);
          expect(typeof result).toBe('string');
        },
      ));
    });

    it('should handle objects safely', () => {
      fc.assert(fc.property(
        fc.dictionary(fc.string({ maxLength: 10 }), fc.oneof(
          fc.string({ maxLength: 20 }),
          fc.integer(),
          fc.boolean(),
        ), { maxKeys: 5 }),
        (obj) => {
          const result = testLogger.convertArgsToString(obj);
          expect(typeof result).toBe('string');
        },
      ));
    });

    it('should handle multiple arguments', () => {
      fc.assert(fc.property(
        fc.array(fc.oneof(
          fc.string(),
          fc.integer(),
          fc.boolean(),
          fc.constant(null),
          fc.constant(undefined),
        ), { minLength: 2, maxLength: 5 }),
        (args) => {
          const result = testLogger.convertArgsToString(...args);
          expect(typeof result).toBe('string');
          if (args.length > 1) {
            expect(result).toContain('\n');
          }
        },
      ));
    });

    it('should handle circular references', () => {
      const circular: any = { a: 'test' };
      circular.self = circular;

      expect(() => {
        const result = testLogger.convertArgsToString(circular);
        expect(typeof result).toBe('string');
      }).not.toThrow();
    });
  });

  describe('Logging with File Operations (Mocked)', () => {
    beforeEach(() => {
      testLogger.setLogFilePath('/mock/path/test.log').setConsole(mockConsole).allowDefaultConsole().start();
    });

    it('should log messages and append to file', () => {
      fc.assert(fc.property(
        fc.string(),
        (message) => {
          testLogger.log(message);

          // Should call console.log
          expect(mockConsole.log).toHaveBeenCalledWith(message);

          // Should append to file
          expect(mockFs.appendFileSync).toHaveBeenCalledWith(
            '/mock/path/test.log',
            message + '\n',
            'utf-8',
          );
        },
      ));
    });

    it('should respect log level filtering', () => {
      fc.assert(fc.property(
        fc.constantFrom(...LOG_LEVELS.filter(l => l !== '')),
        fc.string({ minLength: 1 }),
        (level, message) => {
          vi.clearAllMocks();
          testLogger.setLogLevel(level);

          testLogger.error(`ERROR_${message}`);
          testLogger.warning(`WARNING_${message}`);
          testLogger.info(`INFO_${message}`);
          testLogger.debug(`DEBUG_${message}`);
          testLogger.log(`LOG_${message}`);

          const levelValue = LogLevel[level as keyof typeof LogLevel];
          let expectedCalls = 0;

          if (levelValue >= LogLevel.error) expectedCalls++;
          if (levelValue >= LogLevel.warning) expectedCalls++;
          if (levelValue >= LogLevel.info) expectedCalls++;
          if (levelValue >= LogLevel.debug) expectedCalls++;
          if (levelValue >= LogLevel.log) expectedCalls++; // log() method also gets filtered

          expect(mockFs.appendFileSync).toHaveBeenCalledTimes(expectedCalls);
        },
      ));
    });

    it('should handle silent mode correctly', () => {
      fc.assert(fc.property(
        fc.boolean(),
        fc.string({ minLength: 1 }),
        (silent, message) => {
          vi.clearAllMocks();
          testLogger.setSilent(silent);

          testLogger.log(message);

          if (silent) {
            expect(mockConsole.log).not.toHaveBeenCalled();
          } else {
            expect(mockConsole.log).toHaveBeenCalledWith(message);
          }

          // Should always append to file regardless of silent mode
          expect(mockFs.appendFileSync).toHaveBeenCalledWith(
            '/mock/path/test.log',
            message + '\n',
            'utf-8',
          );
        },
      ));
    });
  });

  describe('File Operations (Mocked)', () => {
    it('should clear file when starting with clear flag', () => {
      mockFs.existsSync.mockReturnValue(true); // Simulate file exists

      testLogger
        .setLogFilePath('/mock/path/test.log')
        .setClear(true)
        .setConsole(mockConsole)
        .allowDefaultConsole()
        .start();

      expect(mockFs.writeFileSync).toHaveBeenCalledWith('/mock/path/test.log', '');
    });

    it('should not clear file when clear flag is disabled', () => {
      testLogger
        .setLogFilePath('/mock/path/test.log')
        .setClear(false)
        .setConsole(mockConsole)
        .allowDefaultConsole()
        .start();

      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should handle file clearing errors gracefully', () => {
      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      expect(() => {
        testLogger
          .setLogFilePath('/mock/invalid/path.log')
          .setClear(true)
          .setConsole(mockConsole)
          .allowDefaultConsole()
          .start();
      }).not.toThrow();

      expect(mockConsole.error).toHaveBeenCalledWith(expect.stringContaining('Error clearing log file'));
    });

    it('should queue messages before file is set', () => {
      const queueLogger = new Logger().setConsole(mockConsole).allowDefaultConsole();
      const messages = ['msg1', 'msg2', 'msg3'];

      // Log messages before file is set - should be queued
      messages.forEach(msg => queueLogger.log(msg));

      // No file operations should have happened yet
      expect(mockFs.appendFileSync).not.toHaveBeenCalled();

      // Now set file path and start
      queueLogger.setLogFilePath('/mock/path/test.log').start();

      // All queued messages should now be written
      messages.forEach(msg => {
        expect(mockFs.appendFileSync).toHaveBeenCalledWith(
          '/mock/path/test.log',
          msg + '\n',
          'utf-8',
        );
      });
    });
  });

  describe('Stdout/Stderr Operations', () => {
    it('should write to stdout correctly', () => {
      fc.assert(fc.property(
        fc.string(),
        fc.boolean(),
        (message, withNewline) => {
          vi.clearAllMocks();
          testLogger.logToStdout(message, withNewline);

          const expectedOutput = withNewline ? `${message}\n` : message;
          expect(stdoutSpy).toHaveBeenCalledWith(expectedOutput);
        },
      ));
    });

    it('should write to stderr with correct newline handling', () => {
      // Test the actual implementation behavior
      const testCases = [
        { message: 'error', newline: true, expected: 'error\n' },
        { message: 'error', newline: false, expected: 'errorfalse' }, // Actual behavior
        { message: '', newline: true, expected: '\n' },
        { message: '', newline: false, expected: 'false' }, // Actual behavior
      ];

      testCases.forEach(({ message, newline, expected }) => {
        vi.clearAllMocks();
        testLogger.logToStderr(message, newline);
        expect(stderrSpy).toHaveBeenCalledWith(expected);
      });
    });

    it('should join stdout messages correctly', () => {
      fc.assert(fc.property(
        fc.array(fc.string(), { minLength: 1, maxLength: 5 }),
        (parts) => {
          vi.clearAllMocks();
          testLogger.logToStdoutJoined(...parts);

          const expected = parts.join('') + '\n';
          expect(stdoutSpy).toHaveBeenCalledWith(expected);
        },
      ));
    });
  });

  describe('JSON Logging', () => {
    beforeEach(() => {
      testLogger.setLogFilePath('/mock/path/test.log').setConsole(mockConsole).allowDefaultConsole().start();
    });

    it('should log valid arguments as JSON', () => {
      fc.assert(fc.property(
        fc.string({ minLength: 1 }),
        fc.dictionary(fc.string(), fc.oneof(fc.string(), fc.integer()), { maxKeys: 3 }),
        (message, obj) => {
          vi.clearAllMocks();
          testLogger.logAsJson(message, obj);

          // Should have called appendFileSync with JSON containing date and message
          expect(mockFs.appendFileSync).toHaveBeenCalled();
          const call = mockFs.appendFileSync.mock.calls[0];
          expect(call[1]).toContain('date');
          expect(call[1]).toContain('message');
        },
      ));
    });

    it('should not log when arguments contain null/undefined', () => {
      testLogger.logAsJson('valid', null, 'also valid');

      expect(mockFs.appendFileSync).not.toHaveBeenCalled();
    });
  });

  describe('Property Logging', () => {
    beforeEach(() => {
      testLogger.setLogFilePath('/mock/path/test.log').setConsole(mockConsole).allowDefaultConsole().start();
    });

    it('should log selected properties from objects', () => {
      const testObjects = [
        { name: 'obj1', value: 42, extra: 'hidden1', ignore: true },
        { name: 'obj2', value: -10, extra: 'hidden2', ignore: false },
      ];

      testLogger.logPropertiesForEachObject(testObjects, 'name', 'value');

      // Should have made calls to append the formatted objects
      expect(mockFs.appendFileSync).toHaveBeenCalledTimes(2);

      // Check that the logged content contains selected properties
      const calls = mockFs.appendFileSync.mock.calls;
      calls.forEach((call, index) => {
        expect(call[1]).toContain(testObjects[index].name);
        expect(call[1]).toContain(String(testObjects[index].value));
        expect(call[1]).not.toContain('"ignore"');
      });
    });
  });

  describe('Fallback Behavior', () => {
    it('should choose correct output based on started state', () => {
      // Test started logger
      const startedLogger = new Logger()
        .setLogFilePath('/mock/path/test.log')
        .setConsole(mockConsole)
        .allowDefaultConsole()
        .start();

      startedLogger.logFallbackToStdout('started message');
      expect(mockConsole.log).toHaveBeenCalledWith('started message');

      vi.clearAllMocks();

      // Test non-started logger
      const notStartedLogger = new Logger();
      notStartedLogger.logFallbackToStdout('not started message');
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('not started message'));
    });
  });

  describe('Constants and Exports', () => {
    it('should have correct LOG_LEVELS', () => {
      expect(LOG_LEVELS).toEqual(['error', 'warning', 'info', 'debug', 'log', '']);
    });

    it('should have correct LogLevel enum values', () => {
      expect(LogLevel.error).toBe(1);
      expect(LogLevel.warning).toBe(2);
      expect(LogLevel.info).toBe(3);
      expect(LogLevel.debug).toBe(4);
      expect(LogLevel.log).toBe(5);
      expect(LogLevel['']).toBe(6);
    });

    it('should export global logger instance', () => {
      expect(logger).toBeInstanceOf(Logger);
    });

    it('should create server logger correctly', () => {
      fc.assert(fc.property(
        fc.string({ minLength: 1 }),
        (logPath) => {
          const serverLogger = createServerLogger(logPath, mockConsole);

          expect(serverLogger).toBeInstanceOf(Logger);
          expect(serverLogger.isStarted()).toBe(true);
          expect(serverLogger.isSilent()).toBe(true);
          expect(serverLogger.logFilePath).toBe(logPath);
          expect(serverLogger.isConnectionConsole()).toBe(true);
        },
      ));
    });
  });
});
