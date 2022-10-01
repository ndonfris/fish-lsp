"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SourceDefinitionCommand = void 0;
//import { Position } from '../utils/typeConverters.js';
//import { toLocation, uriToPath } from '../protocol-translation';
//import type { LspDocuments } from '../document';
//import type { LspClient } from '../lsp-client';
//import { CommandTypes } from '../command-types';
class SourceDefinitionCommand {
    //public static readonly id = '_typescript.goToSourceDefinition';
    static execute(uri, position, 
    //documents: LspDocuments,
    //tspClient: TspClient,
    //lspClient: LspClient,
    reporter) {
        return __awaiter(this, void 0, void 0, function* () {
            //if (!position || typeof position.character !== 'number' || typeof position.line !== 'number') {
            //    lspClient.showErrorMessage('Go to Source Definition failed. Invalid position.');
            //    return;
            //}
            //let file: string | undefined;
            //if (!uri || typeof uri !== 'string' || !(file = uriToPath(uri))) {
            //    lspClient.showErrorMessage('Go to Source Definition failed. No resource provided.');
            //    return;
            //}
            //const document = documents.get(file);
            //if (!document) {
            //    lspClient.showErrorMessage('Go to Source Definition failed. File not opened in the editor.');
            //    return;
            //}
            //const args = Position.toFileLocationRequestArgs(file, position);
            //return await lspClient.withProgress<LSP.Location[] | void>({
            //    message: 'Finding source definitions…',
            //    reporter,
            //}, async () => {
            //    const response = await tspClient.request(CommandTypes.FindSourceDefinition, args);
            //    if (response.type !== 'response' || !response.body) {
            //        lspClient.showErrorMessage('No source definitions found.');
            //        return;
            //    }
            //    return response.body.map(reference => toLocation(reference, documents));
            //});
            return;
        });
    }
}
exports.SourceDefinitionCommand = SourceDefinitionCommand;
//# sourceMappingURL=source-definition.js.map