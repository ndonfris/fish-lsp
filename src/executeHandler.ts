import { TextDocumentPositionParams, Connection } from 'vscode-languageserver';
import {exec} from 'child_process'

 export function execRequest(connection: Connection, line: string) {
  // Here you would execute the current line in the parent shell environment
  // For example, you could use Node.js's child_process to execute the command
  exec(line, (error: any, stdout: any, stderr: any) => {
    if (error) {
      connection.window.showErrorMessage(`Error: ${error.message}`);
      return;
    }
    if (stderr) {
      connection.window.showErrorMessage(`Stderr: ${stderr}`);
      return;
    }
    connection.window.showInformationMessage(`Executed: ${line}\nOutput: ${stdout}`);
  });
}

