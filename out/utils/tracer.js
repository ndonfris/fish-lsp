"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/*
 * Copyright (C) 2022 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Trace = void 0;
//import { Logger } from '../utils/logger';
var Trace;
(function (Trace) {
    Trace[Trace["Off"] = 0] = "Off";
    Trace[Trace["Messages"] = 1] = "Messages";
    Trace[Trace["Verbose"] = 2] = "Verbose";
})(Trace = exports.Trace || (exports.Trace = {}));
(function (Trace) {
    function fromString(value) {
        value = value.toLowerCase();
        switch (value) {
            case 'off':
                return Trace.Off;
            case 'messages':
                return Trace.Messages;
            case 'verbose':
                return Trace.Verbose;
            default:
                return Trace.Off;
        }
    }
    Trace.fromString = fromString;
})(Trace = exports.Trace || (exports.Trace = {}));
class Tracer {
    constructor(
    //private readonly logger: Logger,
    trace) {
        this.trace = trace;
    }
    //public traceRequest(serverId: string, request: Request, responseExpected: boolean, queueLength: number): void {
    //    if (this.trace === Trace.Off) {
    //        return;
    //    }
    //    let data: string | undefined = undefined;
    //    if (this.trace === Trace.Verbose && request.arguments) {
    //        data = `Arguments: ${JSON.stringify(request.arguments, null, 4)}`;
    //    }
    //    this.logTrace(serverId, `Sending request: ${request.command} (${request.seq}). Response expected: ${responseExpected ? 'yes' : 'no'}. Current queue length: ${queueLength}`, data);
    //}
    //public traceResponse(serverId: string, response: Response, meta: RequestExecutionMetadata): void {
    //    if (this.trace === Trace.Off) {
    //        return;
    //    }
    //    let data: string | undefined = undefined;
    //    if (this.trace === Trace.Verbose && response.body) {
    //        data = `Result: ${JSON.stringify(response.body, null, 4)}`;
    //    }
    //    this.logTrace(serverId, `Response received: ${response.command} (${response.request_seq}). Request took ${Date.now() - meta.queuingStartTime} ms. Success: ${response.success} ${!response.success ? `. Message: ${response.message}` : ''}`, data);
    //}
    //public traceRequestCompleted(serverId: string, command: string, request_seq: number, meta: RequestExecutionMetadata): any {
    //    if (this.trace === Trace.Off) {
    //        return;
    //    }
    //    this.logTrace(serverId, `Async response received: ${command} (${request_seq}). Request took ${Date.now() - meta.queuingStartTime} ms.`);
    //}
    //public traceEvent(serverId: string, event: Event): void {
    //    if (this.trace === Trace.Off) {
    //        return;
    //    }
    //    let data: string | undefined = undefined;
    //    if (this.trace === Trace.Verbose && event.body) {
    //        data = `Data: ${JSON.stringify(event.body, null, 4)}`;
    //    }
    //    this.logTrace(serverId, `Event received: ${event.event} (${event.seq}).`, data);
    //}
    logTrace(serverId, message, data) {
        //if (this.trace !== Trace.Off) {
        //    this.logger.trace('Trace', `<${serverId}> ${message}`, data);
        //}
    }
}
exports.default = Tracer;
//# sourceMappingURL=tracer.js.map