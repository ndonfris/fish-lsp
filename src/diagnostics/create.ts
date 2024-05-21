import { Range, CodeDescription, Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { LspDocument } from '../document';
import { getRange } from '../utils/tree-sitter';
import * as errorCodes from './errorCodes';
import { createCodeDescription } from './codeDescription';

export function createDiagnostic(node: SyntaxNode, code: number, document?: LspDocument): Diagnostic {
  let severity: DiagnosticSeverity = DiagnosticSeverity.Error;
  let message: string;
  const source: string = 'fish-lsp';
  const range: Range = getRange(node);
  switch (code) {
    case errorCodes.missingAutoloadedFunctionName:
      severity = DiagnosticSeverity.Warning;
      message = `Warning: function '${node.text}' not found in autoloaded '$FISH_PATH/function' file`;
      break;
    case errorCodes.duplicateFunctionName:
      message = `Error: function '${node.text}' already defined`;
      break;
    case errorCodes.missingEnd:
      message = 'Error: missing end';
      break;
    case errorCodes.extraEnd:
      message = 'Error: extra end';
      break;
    case errorCodes.unreachableCode:
      message = 'Error: unreachable code';
      break;
    case errorCodes.universalVariable:
      if (document?.uri.endsWith('config.fish')) {
        message = 'Error: Universal variables are not allowed in config.fish';
        break;
      }
      message = 'Warning: Universal variables are discouraged outside of interactive sessions';
      severity = DiagnosticSeverity.Warning;
      break;
    case errorCodes.pathVariable:
      message = "Information: Path variables are split with ':'. '/usr/bin:/usr/local/bin' is equivalent to '/usr/bin' '/usr/local/bin'";
      severity = DiagnosticSeverity.Information;
      break;
    case errorCodes.pathFlag:
      message = "Information: The preferred naming convention to handle path variables specially requires a 'PATH' in your variable name";
      severity = DiagnosticSeverity.Information;
      break;
    case errorCodes.syntaxError:
      message = 'Error: could not parse command';
      severity = DiagnosticSeverity.Error;
      break;
    case errorCodes.privateHelperFunction:
      message = "Warning: private helper functions in autoloaded path, should begin with leading '_' to avoid name collisions";
      severity = DiagnosticSeverity.Warning;
      break;
    default:
      message = ' E' + code.toString();
      severity = DiagnosticSeverity.Error;
      break;
  }
  return {
    message: message,
    range: range,
    severity: severity,
    code: code,
    source: 'fish-lsp',
    codeDescription: createCodeDescription(code),
  };
}

