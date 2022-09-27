import * as LSP from 'vscode-languageserver';
import type { LspDocuments } from '../document';
export declare class SourceDefinitionCommand {
    static execute(uri: LSP.DocumentUri | undefined, position: LSP.Position | undefined, documents: LspDocuments, reporter: LSP.WorkDoneProgressReporter): Promise<LSP.Location[] | void>;
}
//# sourceMappingURL=source-definition.d.ts.map