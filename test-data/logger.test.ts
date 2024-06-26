import { createJestLogger, createServerLogger, ServerLogsPath } from '../src/logger';
import { setLogger } from './helpers';
import { readFileSync } from 'node:fs';

setLogger();

function getLogfileContent(filepath: string = ServerLogsPath) {
  return readFileSync(ServerLogsPath, 'utf8');
}

describe('Logger', () => {
  it('jest logging', () => {
    const logger = createJestLogger();
    logger.log('hello world');
  });

  it('show that `logfile === "./fish-lsp/logs.txt"`', () => {
    const logfile = ServerLogsPath;
    expect(logfile.endsWith('fish-lsp/logs.txt'));
  });

  it('server logging', () => {
    const logfile = ServerLogsPath;
    const logger = createServerLogger(logfile, true);
    logger.log('hello world');
    logger.showLogfileText();
  });

  it('should output to correct "logs.txt" file', () => {
    const path = ServerLogsPath;
    const paths = path.split('/');
    const dirname = paths[paths.length - 2];
    const filename = paths[paths.length - 1];
    const loggerFile = [dirname, filename].join('/');
    console.log(loggerFile);
    console.log(path);
  });

  it('logger.logAsJson', () => {
    const logger = createServerLogger(ServerLogsPath, true);
    logger.logAsJson(
      'showTime',
    );
    expect(JSON.parse(getLogfileContent())).toEqual({
      date: new Date().toLocaleString(),
      message: 'showTime',
    });
  });

  it('logger.log', () => {
    const logger = createServerLogger(ServerLogsPath, true);
    logger.log(JSON.stringify({ a: 'a', b: 'b' }));
    expect(JSON.parse(getLogfileContent())).toEqual({
      a: 'a',
      b: 'b',
    });
  });
});
