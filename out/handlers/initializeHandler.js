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
exports.getInitializeHandler = void 0;
const node_1 = require("vscode-languageserver/node");
const parser_1 = require("../parser");
// Cannot use matches with file types until new release
// https://github.com/microsoft/vscode-languageserver-node/issues/734
const fileOperationFilter = {
    pattern: {
        glob: '**/*.fish',
        options: { ignoreCase: true },
    },
};
const folderOperationFilter = {
    pattern: {
        glob: '**/*',
    },
};
function getInitializeHandler(context) {
    return function handleInitialize(params, _cancel, progressReporter) {
        return __awaiter(this, void 0, void 0, function* () {
            progressReporter.begin('Initializing');
            context.capabilities = context.capabilities;
            context.parser = yield (0, parser_1.initializeParser)();
            context.completion = yield context.completion.initialDefaults();
            const result = {
                capabilities: {
                    textDocumentSync: node_1.TextDocumentSyncKind.Incremental,
                    completionProvider: {
                        resolveProvider: true,
                    },
                    definitionProvider: true,
                    documentHighlightProvider: true,
                    documentSymbolProvider: true,
                    workspaceSymbolProvider: true,
                    referencesProvider: true,
                    hoverProvider: true,
                    renameProvider: { prepareProvider: true },
                    documentFormattingProvider: false,
                    workspace: {
                        fileOperations: {
                            willDelete: {
                                filters: [fileOperationFilter, folderOperationFilter],
                            },
                            didDelete: {
                                filters: [fileOperationFilter, folderOperationFilter],
                            },
                            didCreate: {
                                filters: [fileOperationFilter],
                            },
                            didRename: {
                                filters: [fileOperationFilter, folderOperationFilter],
                            },
                        },
                    },
                },
            };
            //context.connection.console.log('handleInitialized()')
            progressReporter.done();
            return result;
        });
    };
}
exports.getInitializeHandler = getInitializeHandler;
//# sourceMappingURL=initializeHandler.js.map