import { WorkDoneProgressReporter } from 'vscode-languageserver/lib/common/progress';
import { CancellationToken, InitializeParams, InitializeResult } from 'vscode-languageserver/node';
import { Context } from '../interfaces';
export declare function getInitializeHandler(context: Context): (params: InitializeParams, _cancel: CancellationToken, progressReporter: WorkDoneProgressReporter) => Promise<InitializeResult>;
//# sourceMappingURL=initializeHandler.d.ts.map