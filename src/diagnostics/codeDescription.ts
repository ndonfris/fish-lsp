import {CodeDescription} from 'vscode-languageserver';
import * as errorCodes from './errorCodes';

export function createCodeDescription(code: number): CodeDescription {
    switch (code) {
        case errorCodes.missingAutoloadedFunctionName:
            return {
                href: 'https://fishshell.com/docs/current/language.html#autoloading-functions'
            }
        case errorCodes.duplicateFunctionName:
            return {
                href: 'https://fishshell.com/docs/current/cmds/function.html',
            }
        case errorCodes.unreachableCode:
            return {
                href: 'https://fishshell.com/docs/current/cmds/return.html'
            }
        case errorCodes.missingEnd:
        case errorCodes.extraEnd:
            return {
                href: 'https://fishshell.com/docs/current/cmds/end.html',
            }
        case errorCodes.unusedVariable:
            return {
                href: "https://fishshell.com/docs/current/tutorial.html#tut_variables",
            }
        case errorCodes.universalVariable:
            return {
                href: 'https://fishshell.com/docs/current/language.html#variables-universal'
            }
        default: 
            return { 
                href: 'https://fishshell.com/docs/current/language.html#' 
            }
    }
}
