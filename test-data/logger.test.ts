import {assert} from 'chai';
import { createJestLogger, createServerLogger, Logger, ServerLogsPath } from '../src/logger';
import { setLogger } from './helpers';


setLogger()


describe('Logger', () => {
    it('should output to correct "logs.txt" file', () => {
        const path = ServerLogsPath;
        const paths = path.split('/');
        const dirname = paths[paths.length-2];
        const filename = paths[paths.length-1];
        const loggerFile = [dirname,filename].join('/');
        console.log(loggerFile);
        console.log(path);
    })

    it('server logging', () => {
        const logfile = ServerLogsPath;
        const logger =  createServerLogger(logfile, true)
        logger.log("hello world")
    })


    it('jest logging', () => {
        const logger =  createJestLogger()
        logger.log("hello world")
    })
})