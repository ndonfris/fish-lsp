#!/usr/bin/env node
'use strict';
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
exports.startServer = void 0;
const node_1 = require("vscode-languageserver/node");
const server_1 = __importDefault(require("./server"));
function startServer() {
    // Create a connection for the server.
    // The connection uses stdin/stdout for communication.
    const connection = (0, node_1.createConnection)(new node_1.StreamMessageReader(process.stdin), new node_1.StreamMessageWriter(process.stdout));
    connection.onInitialize((params) => __awaiter(this, void 0, void 0, function* () {
        connection.console.log(`Initialized server FISH-LSP with ${params.initializationOptions}`);
        const server = yield server_1.default.initialize(connection, params);
        server.register();
        return {
            capabilities: server.capabilities(),
        };
    }));
    connection.listen();
}
exports.startServer = startServer;
startServer();
//# sourceMappingURL=cli.js.map