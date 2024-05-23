import { CodeDescription } from 'vscode-languageserver';
import * as errorCodes from './errorCodes';

// notes:
//      • https://fishshell.com/docs/current/language.html
//      • https://fishshell.com/docs/current/language.html#debugging-fish-scripts
//      • https://fishshell.com/docs/current/language.html#functions
//      • build query searcher
export function createCodeDescription(code: number): CodeDescription {
  switch (code) {
    case errorCodes.missingAutoloadedFunctionName:
      return {
        href: 'https://fishshell.com/docs/current/language.html#autoloading-functions',
      };
    case errorCodes.duplicateFunctionName:
      return {
        href: 'https://fishshell.com/docs/current/cmds/function.html',
      };
    case errorCodes.privateHelperFunction:
      return {
        href: 'https://fishshell.com/docs/current/completions.html#useful-functions-for-writing-completions',
      };

    case errorCodes.unreachableCode:
      return {
        href: 'https://fishshell.com/docs/current/cmds/return.html',
      };
    case errorCodes.missingEnd:
    case errorCodes.extraEnd:
      return {
        href: 'https://fishshell.com/docs/current/cmds/end.html',
      };
    case errorCodes.unusedVariable:
      return {
        href: 'https://fishshell.com/docs/current/tutorial.html#tut_variables',
      };
    case errorCodes.universalVariable:
      return {
        href: 'https://fishshell.com/docs/current/language.html#variables-universal',
      };
    case errorCodes.pathFlag:
    case errorCodes.pathVariable:
      return {
        href: 'https://fishshell.com/docs/current/language.html#path-variables',

      };
    case errorCodes.syntaxError:
      return {
        href: 'https://fishshell.com/docs/current/language.html',
      };
    default:
      return {
        href: 'https://fishshell.com/docs/current/language.html#',
      };
  }
}
