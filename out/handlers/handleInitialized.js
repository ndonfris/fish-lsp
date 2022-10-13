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
exports.getInitializedHandler = void 0;
const analyze_1 = require("../analyze");
const parser_1 = require("../parser");
const io_1 = require("../utils/io");
function getInitializedHandler(context) {
    const { trees, analyzer, documents } = context;
    function index(workspaceFolders) {
        return __awaiter(this, void 0, void 0, function* () {
            const urls = workspaceFolders.flatMap((folder) => (0, io_1.getFishFilesInDir)(folder.uri));
            // Analyze every file in a workspace
            for (const url of urls) {
                const document = yield (0, io_1.createTextDocumentFromFilePath)(context, url);
                if (document) {
                    context.connection.console.log(`document: ${document.uri}`);
                    try {
                        yield context.analyzer.initialize(context, document);
                    }
                    catch (error) {
                        context.connection.console.log(`ERROR: ${error}`);
                        context.connection.console.log(`ERROR: ${typeof analyzer.initialize}`);
                    }
                }
                //dependencies.update(url.href, new Set(dependencyUris));
            }
        });
    }
    function initializeContext() {
        return __awaiter(this, void 0, void 0, function* () {
            context.parser = yield (0, parser_1.initializeParser)();
            context.analyzer = new analyze_1.Analyzer(context.parser);
            context.connection.console.log('initializing completionDefaults()');
            yield context.completion.initialDefaults();
            context.connection.console.log('finished completionDefaults()');
        });
    }
    return function handleInitialized() {
        var _a, _b;
        return __awaiter(this, void 0, void 0, function* () {
            const progressReporter = yield context.connection.window.createWorkDoneProgress();
            const workspaceFolders = (_a = (yield context.connection.workspace.getWorkspaceFolders())) !== null && _a !== void 0 ? _a : [];
            if ((_b = context.cliOptions) === null || _b === void 0 ? void 0 : _b.noIndex) {
                context.connection.console.log("Indexing skipped");
            }
            else {
                progressReporter.begin("Indexing");
                yield initializeContext();
                yield index(workspaceFolders);
                progressReporter.done();
            }
            progressReporter.begin("Initializing formatter");
            //initFormatter(workspaceFolders, context.connection);
            progressReporter.done();
        });
    };
}
exports.getInitializedHandler = getInitializedHandler;
//# sourceMappingURL=handleInitialized.js.map