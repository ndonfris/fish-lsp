#!/usr/bin/env node
//'use strict'
import {TextDocument} from 'vscode-languageserver-textdocument';
import { createConnection, InitializeParams, InitializeResult, ProposedFeatures, StreamMessageReader, StreamMessageWriter, TextDocuments, TextDocumentSyncKind } from "vscode-languageserver/node";
import {URI} from 'vscode-uri';
import Parser from 'web-tree-sitter';
import {initializeParser} from './parser';
import FishServer from './server';
//import {getAllFishLocations} from './utils/locations';

import { BuildAsciiLogo, program } from './utils/commander-cli-subcommands'
import { env } from 'process';
import { sys } from 'typescript';


const logo = BuildAsciiLogo()


// program.showHelpAfterError();
// console.log('opts: ', JSON.stringify( Object.keys( program.opts ) ));




export function startServer() {
    // Create a connection for the server.
    // The connection uses stdin/stdout for communication.
    //const connection = createConnection(
    //    new StreamMessageReader(process.stdin),
    //    new StreamMessageWriter(process.stdout)
    //);
    const connection = createConnection(
        new StreamMessageReader(process.stdin),
        new StreamMessageWriter(process.stdout)
    )
    //const token = connection.window.attachWorkDoneProgress('Initializing Fish Language Server');
    //token.begin('Fish Language Server', 0, 'Initializing', true);
    //token.report(0);
    //token.begin('Initializing Fish Language Server');
    connection.onInitialize(
        async (params: InitializeParams): Promise<InitializeResult> => {
            console.log(`Initialized server FISH-LSP`);
            connection.console.log(`Initialized server FISH-LSP with ${JSON.stringify(params)}`);
            const server = await FishServer.create(connection, params);
            server.register();
            return server.initialize(params);
        }
    )
    connection.listen()
    //token.done();
}


if (require.main === module) {
    startServer();
}

// program.command('start').description('Start the language server').action(() => {return startServer()})
//
// program.parse();
// const opts = program.opts()
// // console.log(opts);
// if (opts['lsp-version']) {
//     console.log(logo);
//     process.exit(0);
// } else if (opts.version) {
//     console.log(logo);
//     process.exit(0)
// } else if (opts.help) {
//     console.log(logo);
//     process.exit(1)
// }
// const subcmds = program.commands
// // console.log('subcmds: ', subcmds);
// for (const cmd of subcmds) {
//     switch (cmd.name()) {
//         case 'complete':
//         case 'capabilites':
//         case 'report':
//             process.exit(0);
//             
//         case 'show-path':
//             console.log(
//                 "\n\n",
//                 logo,
//                 "\n\n");
//             console.log("path: ", __dirname);
//             process.exit(0);
//         default:
//             break;
//     }
// }
// startServer();