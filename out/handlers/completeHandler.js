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
exports.getCompletionHandler = void 0;
const io_1 = require("../utils/io");
function getCompletionHandler(context) {
    const { completion, analyzer, documents, trees } = context;
    return function handleCompletion(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const uri = params.textDocument.uri;
            const line = params.position.line;
            const character = params.position.character;
            //context.connection.console.log("handleComplete")
            //console.log(`handleComplete()`)
            //console.log(`\turi: '${uri}'`)
            //console.log(`\tline: '${line}'`)
            //console.log(`\tcharacter: '${character}'`)
            //console.log(`\ttree: '${trees[uri]}'`)
            //const variables = trees[uri].variables;
            //const functions = trees[uri].functions;
            if (!documents.get(uri)) {
                const doc = yield (0, io_1.createTextDocumentFromFilePath)(context, new URL(uri));
                if (!doc)
                    return null;
                trees[uri] = yield analyzer.initialize(context, doc);
            }
            const currLine = analyzer.currentLine(context, uri, line);
            //const amountAdded = completion.addLocalMembers(variables, functions)
            // stores the amount of new completions found
            //if (currLine.endsWith('-')) {
            //    // get completion here
            //}
            const node = analyzer.nodeAtPoint(trees[uri], line, character);
            if (!node)
                return completion.fallback();
            try {
                const cmpList = yield completion.generate(node);
                if (cmpList)
                    return cmpList;
            }
            catch (error) {
                //context.connection.console.error('handleCompletion() got error: '+error)
            }
            return completion.fallback();
        });
    };
}
exports.getCompletionHandler = getCompletionHandler;
//# sourceMappingURL=completeHandler.js.map