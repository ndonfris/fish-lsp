import { exec } from 'child_process';

export async function formatDocumentContent(content: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const process = exec('fish_indent', (error, stdout, stderr) => {
            if (error) {
                reject(stderr);
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