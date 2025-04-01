import { exec } from 'child_process';
import { logger } from './logger';

export async function formatDocumentContent(content: string): Promise<string> {
  return new Promise((resolve, _reject) => {
    const process = exec('fish_indent', (error, stdout, stderr) => {
      if (error) {
        // reject(stderr);
        logger.log('Formatting Error:', stderr);
      } else {
        resolve(stdout);
      }
    });
    if (process.stdin) {
      process.stdin.write(content);
      process.stdin.end();
    }
  });
}
