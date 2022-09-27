'use strict'
import { createConnection, InitializeParams, InitializeResult, ProposedFeatures, StreamMessageReader, StreamMessageWriter } from "vscode-languageserver/node";
import FishServer from './server';

//const connection = require.main
//    ? createConnection(ProposedFeatures.all)
//    : createConnection(process.stdin, process.stdout)

export function listen() {
    // Create a connection for the server.
    // The connection uses stdin/stdout for communication.
    let connection = createConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout))
    //RPC.createConnection(
    //        new RPC.StreamMessageReader(process.stdin),
    //        new RPC.StreamMessageWriter(process.stdout));


    //let notification = new RPC.NotificationType<string>('RUNNINg');
    //msgConnection.sendNotification(notification)
    //msgConnection.listen()

    connection.onInitialize(
        async (params: InitializeParams): Promise<InitializeResult> => {
            connection.console.log(
                `Initialized server FISH-LSP with ${params.initializationOptions}`
            );

            const server = await FishServer.initialize(connection, params);

            server.register(connection);

            return {
                capabilities: server.capabilities(),
            };
        },
    )
    connection.listen() 
}
