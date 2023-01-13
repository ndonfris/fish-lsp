// https://github.com/typescript-language-server/typescript-language-server/blob/5a39c1f801ab0cad725a2b8711c0e0d46606a08b/src/tsServer/server.ts#L52

import { CancellationToken } from 'vscode-jsonrpc';
//import { RequestItem, RequestQueue, RequestQueueingType } from './requestQueue.js';
//import { ServerResponse, ServerType, TypeScriptRequestTypes } from './requests.js';
//import { FishProtocol } from './fishProtocol'
//import type { TspClientOptions } from '../tsp-client.js';
//import { OngoingRequestCanceller } from './cancellation.js';
//import { CallbackMap } from './callbackMap.js';
//import { TypeScriptServerError } from './serverError.js';
//import type Tracer from './tracer.js';
//import type { TypeScriptVersion } from './versionProvider.js';
//
//export enum ExecutionTarget {
//    Semantic,
//    Syntax
//}
//
//export interface TypeScriptServerExitEvent {
//    readonly code: number | null;
//    readonly signal: NodeJS.Signals | null;
//}
//
//type OnEventHandler = (e: FishProtocol.Event) => any;
//type OnExitHandler = (e: TypeScriptServerExitEvent) => any;
//type OnErrorHandler = (e: any) => any;
//type OnStdErrHandler = (e: string) => any;
//
//export interface ITypeScriptServer {
//    onEvent(handler: OnEventHandler): void;
//    onExit(handler: OnExitHandler): void;
//    onError(handler: OnErrorHandler): void;
//    onStdErr(handler: OnStdErrHandler): void;
//
//    readonly tsServerLogFile: string | undefined;
//
//    kill(): void;
//
//    /**
//     * @return A list of all execute requests. If there are multiple entries, the first item is the primary
//     * request while the rest are secondary ones.
//     */
//    executeImpl(command: keyof TypeScriptRequestTypes, args: any, executeInfo: { isAsync: boolean; token?: CancellationToken; expectsResult: boolean; lowPriority?: boolean; executionTarget?: ExecutionTarget; }): Array<Promise<ServerResponse.Response<FishProtocol.Response>> | undefined>;
//
//    dispose(): void;
//}
//
//export const enum TsServerProcessKind {
//    Main = 'main',
//    Syntax = 'syntax',
//    Semantic = 'semantic',
//    Diagnostics = 'diagnostics'
//}
//
//export interface TsServerProcessFactory {
//    fork(
//        version: TypeScriptVersion,
//        args: readonly string[],
//        kind: TsServerProcessKind,
//        configuration: TspClientOptions,
//    ): TsServerProcess;
//}
//
//export interface TsServerProcess {
//    write(serverRequest: FishProtocol.Request): void;
//
//    onData(handler: (data: FishProtocol.Response) => void): void;
//    onExit(handler: (code: number | null, signal: NodeJS.Signals | null) => void): void;
//    onError(handler: (error: Error) => void): void;
//    onStdErr(handler: (code: string) => void): void;
//
//    kill(): void;
//}
//
//export class ProcessBasedTsServer implements ITypeScriptServer {
//    private readonly _requestQueue = new RequestQueue();
//    private readonly _callbacks = new CallbackMap<FishProtocol.Response>();
//    private readonly _pendingResponses = new Set<number>();
//    private readonly _eventHandlers = new Set<OnEventHandler>();
//    private readonly _exitHandlers = new Set<OnExitHandler>();
//    private readonly _errorHandlers = new Set<OnErrorHandler>();
//    private readonly _stdErrHandlers = new Set<OnStdErrHandler>();
//
//    constructor(
//        private readonly _serverId: string,
//        private readonly _serverSource: ServerType,
//        private readonly _process: TsServerProcess,
//        private readonly _tsServerLogFile: string | undefined,
//        private readonly _requestCanceller: OngoingRequestCanceller,
//        private readonly _version: TypeScriptVersion,
//        private readonly _tracer: Tracer,
//    ) {
//        this._process.onData(msg => {
//            this.dispatchMessage(msg);
//        });
//
//        this._process.onStdErr(error => {
//            this._stdErrHandlers.forEach(handler => handler(error));
//        });
//
//        this._process.onExit((code, signal) => {
//            this._exitHandlers.forEach(handler => handler({ code, signal }));
//            this._callbacks.destroy('server exited');
//        });
//
//        this._process.onError(error => {
//            this._errorHandlers.forEach(handler => handler(error));
//            this._callbacks.destroy('server errored');
//        });
//    }
//
//    public onEvent(handler: OnEventHandler): void {
//        this._eventHandlers.add(handler);
//    }
//
//    public onExit(handler: OnExitHandler): void {
//        this._exitHandlers.add(handler);
//    }
//
//    public onStdErr(handler: OnStdErrHandler): void {
//        this._stdErrHandlers.add(handler);
//    }
//
//    public onError(handler: OnErrorHandler): void {
//        this._errorHandlers.add(handler);
//    }
//
//    public get tsServerLogFile(): string | undefined {
//        return this._tsServerLogFile;
//    }
//
//    private write(serverRequest: FishProtocol.Request) {
//        this._process.write(serverRequest);
//    }
//
//    public dispose(): void {
//        this._callbacks.destroy('server disposed');
//        this._pendingResponses.clear();
//        this._eventHandlers.clear();
//        this._exitHandlers.clear();
//        this._errorHandlers.clear();
//    }
//
//    public kill(): void {
//        this.dispose();
//        this._process.kill();
//    }
//
//    private dispatchMessage(message: FishProtocol.Message) {
//        try {
//            switch (message.type) {
//                case 'response':
//                    if (this._serverSource) {
//                        this.dispatchResponse({
//                            ...(message as FishProtocol.Response),
//                        });
//                    } else {
//                        this.dispatchResponse(message as FishProtocol.Response);
//                    }
//                    break;
//
//                case 'event': {
//                    const event = message as FishProtocol.Event;
//                    if (event.event === 'requestCompleted') {
//                        const seq = (event as FishProtocol.RequestCompletedEvent).body.request_seq;
//                        const callback = this._callbacks.fetch(seq);
//                        if (callback) {
//                            this._tracer.traceRequestCompleted(this._serverId, 'requestCompleted', seq, callback);
//                            callback.onSuccess(undefined);
//                        }
//                    } else {
//                        this._tracer.traceEvent(this._serverId, event);
//                        this._eventHandlers.forEach(handler => handler(event));
//                    }
//                    break;
//                }
//                default:
//                    throw new Error(`Unknown message type ${message.type} received`);
//            }
//        } finally {
//            this.sendNextRequests();
//        }
//    }
//
//    private tryCancelRequest(seq: number, command: string): boolean {
//        try {
//            if (this._requestQueue.tryDeletePendingRequest(seq)) {
//                this.logTrace(`Canceled request with sequence number ${seq}`);
//                return true;
//            }
//
//            if (this._requestCanceller.tryCancelOngoingRequest(seq)) {
//                return true;
//            }
//
//            this.logTrace(`Tried to cancel request with sequence number ${seq}. But request got already delivered.`);
//            return false;
//        } finally {
//            const callback = this.fetchCallback(seq);
//            callback?.onSuccess(new ServerResponse.Cancelled(`Cancelled request ${seq} - ${command}`));
//        }
//    }
//
//    private dispatchResponse(response: FishProtocol.Response) {
//        const callback = this.fetchCallback(response.request_seq);
//        if (!callback) {
//            return;
//        }
//
//        this._tracer.traceResponse(this._serverId, response, callback);
//        if (response.success) {
//            callback.onSuccess(response);
//        } else if (response.message === 'No content available.') {
//            // Special case where response itself is successful but there is not any data to return.
//            callback.onSuccess(ServerResponse.NoContent);
//        } else {
//            callback.onError(TypeScriptServerError.create(this._serverId, this._version, response));
//        }
//    }
//
//    public executeImpl(command: keyof TypeScriptRequestTypes, args: any, executeInfo: { isAsync: boolean; token?: CancellationToken; expectsResult: boolean; lowPriority?: boolean; executionTarget?: ExecutionTarget; }): Array<Promise<ServerResponse.Response<FishProtocol.Response>> | undefined> {
//        const request = this._requestQueue.createRequest(command, args);
//        const requestInfo: RequestItem = {
//            request,
//            expectsResponse: executeInfo.expectsResult,
//            isAsync: executeInfo.isAsync,
//            queueingType: ProcessBasedTsServer.getQueueingType(command, executeInfo.lowPriority),
//        };
//        let result: Promise<ServerResponse.Response<FishProtocol.Response>> | undefined;
//        if (executeInfo.expectsResult) {
//            result = new Promise<ServerResponse.Response<FishProtocol.Response>>((resolve, reject) => {
//                this._callbacks.add(request.seq, { onSuccess: resolve as () => ServerResponse.Response<FishProtocol.Response> | undefined, onError: reject, queuingStartTime: Date.now(), isAsync: executeInfo.isAsync }, executeInfo.isAsync);
//
//                if (executeInfo.token) {
//                    executeInfo.token.onCancellationRequested(() => {
//                        this.tryCancelRequest(request.seq, command);
//                    });
//                }
//            });
//        }
//
//        this._requestQueue.enqueue(requestInfo);
//        this.sendNextRequests();
//
//        return [result];
//    }
//
//    private sendNextRequests(): void {
//        // console.error({ pending: this._pendingResponses.size, queue: this._requestQueue.length });
//        while (this._pendingResponses.size === 0 && this._requestQueue.length > 0) {
//            const item = this._requestQueue.dequeue();
//            if (item) {
//                this.sendRequest(item);
//            }
//        }
//    }
//
//    private sendRequest(requestItem: RequestItem): void {
//        const serverRequest = requestItem.request;
//        this._tracer.traceRequest(this._serverId, serverRequest, requestItem.expectsResponse, this._requestQueue.length);
//
//        if (requestItem.expectsResponse && !requestItem.isAsync) {
//            this._pendingResponses.add(requestItem.request.seq);
//        }
//
//        try {
//            this.write(serverRequest);
//        } catch (err) {
//            const callback = this.fetchCallback(serverRequest.seq);
//            callback?.onError(err as Error);
//        }
//    }
//
//    private fetchCallback(seq: number) {
//        const callback = this._callbacks.fetch(seq);
//        if (!callback) {
//            return undefined;
//        }
//
//        this._pendingResponses.delete(seq);
//        return callback;
//    }
//
//    private logTrace(message: string) {
//        this._tracer.logTrace(this._serverId, message);
//    }
//
//    private static readonly fenceCommands = new Set(['change', 'close', 'open', 'updateOpen']);
//
//    private static getQueueingType(
//        command: string,
//        lowPriority?: boolean,
//    ): RequestQueueingType {
//        if (ProcessBasedTsServer.fenceCommands.has(command)) {
//            return RequestQueueingType.Fence;
//        }
//        return lowPriority ? RequestQueueingType.LowPriority : RequestQueueingType.Normal;
//    }
//}
