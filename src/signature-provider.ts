import { FishSymbol } from './utils/symbol';
import * as LSP from 'vscode-languageserver';
import { Analyzer } from './future-analyze';
import { SignatureHelp, SignatureInformation, ParameterInformation } from 'vscode-languageserver';

export const createShellSignature = (
  symbol: FishSymbol, 
  activeIndex: number | null
): LSP.SignatureHelp => {

  // Get command arguments, skipping the command/variable name
  const args = symbol.detail.split(' ')
    // .filter(n => !n.text.startsWith('-'))
    // .slice(1)
    // .map(n => n.text);

  // Format each argument, highlighting the active one
  const formattedArgs = args.map((arg, index) => {
    const isActive = index === activeIndex;
    return isActive ? `*${arg}*` : arg;
  });

  // Build the command signature
  const cmd = symbol.isVariable() ? 'set' : symbol.name;
  const signature: LSP.SignatureInformation = {
    label: `${cmd} ${symbol.name} ${formattedArgs.join(' ')}`,
    parameters: args.map(arg => ({ label: arg , documentation: `$${'argv'}[${activeIndex}]`}))
  };

  return {
    signatures: [signature],
    activeSignature: 0,
    activeParameter: activeIndex ?? 0
  };
};