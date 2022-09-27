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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeParser = void 0;
const path_1 = require("path");
const web_tree_sitter_1 = __importDefault(require("web-tree-sitter"));
const _global = global;
function initializeParser() {
    return __awaiter(this, void 0, void 0, function* () {
        //const parser = new Parser<typeof Parser>()
        if (_global.fetch) {
            delete _global.fetch;
        }
        yield web_tree_sitter_1.default.init();
        const parser = new web_tree_sitter_1.default();
        const tsFishPath = (0, path_1.resolve)(
        //require.resolve('tree-sitter-fish'),
        //'..',
        __dirname, '..', 'tree-sitter-fish.wasm');
        const lang = yield web_tree_sitter_1.default.Language.load(tsFishPath);
        parser.setLanguage(lang);
        return parser;
    });
}
exports.initializeParser = initializeParser;
//# sourceMappingURL=parser.js.map