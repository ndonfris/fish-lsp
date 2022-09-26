import { createConnection, InitializeParams, InitializeResult, ProposedFeatures } from "vscode-languageserver/node";
import FishServer from './server';

import * as RPC from 'vscode-jsonrpc/node';

const connection = require.main
    ? createConnection(ProposedFeatures.all)
    : createConnection(process.stdin, process.stdout)

export function listen() {
    // Create a connection for the server.
    // The connection uses stdin/stdout for communication.



    let msgConnection = RPC.createMessageConnection(
            new RPC.StreamMessageReader(process.stdin),
            new RPC.StreamMessageWriter(process.stdout));


    let notification = new RPC.NotificationType<string>('RUNNINg');
    msgConnection.sendNotification(notification)
    msgConnection.listen()

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
    );
    //const server = await FishServer.initialize(connection, params)
    //connection.onNotification(notification, (param: string) => {
    //    console.log(param); // This prints Hello World
    //});

    //(
    //    new rpc.StreamMessageReader(process.stdin),
    //    new rpc.StreamMessageWriter(process.stdout)
    //);

    //connection.sendNotification(
    //    async (params: LSP.InitializeParams): Promise<LSP.InitializeResult> => {
    //        connection.console.log(
    //            `Initialized server v. ${connection..version} for ${params.rootUri}`
    //        );

    //        const server = await FishServer.initialize(connection, params);

    //        server.register(connection);

    //        return {
    //            capabilities: server.capabilities(),
    //        };
    //    }
    //);
}

listen()
connection.listen()

//if (require.main === module) listen()


