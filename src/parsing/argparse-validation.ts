import { Position } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { md } from '../utils/markdown-builder';
import { dollarVariables, StringVariable, variableAtPoint } from './string-variables';

/**
 * The variables an `argparse 'n/name=!…'` flag validation script runs with, as
 * `man argparse` (FLAG VALUE VALIDATION) describes them.
 */
export const ARGPARSE_VALIDATION_VARIABLES: Readonly<Record<string, string>> = {
  _argparse_cmd: 'Set to the value of the `argparse --name` value.',
  _flag_name: 'Set to the short or long flag being processed.',
  _flag_value: 'Set to the value associated with the flag being processed.',
};

export function isArgparseValidationVariable(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(ARGPARSE_VALIDATION_VARIABLES, name);
}

/** markdown for one of {@link ARGPARSE_VALIDATION_VARIABLES}, or `null` for any other name */
export function argparseValidationVariableDocs(name: string): string | null {
  if (!isArgparseValidationVariable(name)) return null;
  return [
    `(${md.bold('variable')}) ${md.inlineCode(name)}`,
    md.separator(),
    ARGPARSE_VALIDATION_VARIABLES[name],
    '',
    `Local and exported, only while an ${md.inlineCode('argparse')} flag validation script runs:`,
    md.codeBlock('fish', "argparse 'n/name=!<VALIDATION_SCRIPT>'"),
    md.separator(),
    md.italic('https://fishshell.com/docs/current/cmds/argparse.html#flag-value-validation'),
  ].join('\n');
}

/** the `$_flag_value`-like variable under `position` in a validation spec string */
export function argparseValidationVariableAtPoint(node: SyntaxNode, position: Position): StringVariable | null {
  const found = variableAtPoint(dollarVariables(node), position);
  return found && isArgparseValidationVariable(found.name) ? found : null;
}
