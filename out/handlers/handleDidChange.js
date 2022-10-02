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
exports.getDidChangeContentHandler = void 0;
const io_1 = require("../utils/io");
//import { validate } from '../validation/validate'
function getDidChangeContentHandler(context) {
    const { trees, documents, analyzer } = context;
    return function handleDidChangeContent(change) {
        return __awaiter(this, void 0, void 0, function* () {
            context.connection.console.error('handleDidChangeContent()');
            const doc = documents.get(change.document.uri);
            if (doc) {
                yield analyzer.analyze(context, doc);
            }
            else {
                const newDoc = yield (0, io_1.createTextDocumentFromFilePath)(context, new URL(change.document.uri));
                if (newDoc)
                    trees[change.document.uri] = yield analyzer.initialize(context, newDoc);
            }
        });
    };
}
exports.getDidChangeContentHandler = getDidChangeContentHandler;
//# sourceMappingURL=handleDidChange.js.map