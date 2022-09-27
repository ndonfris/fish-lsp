export declare enum Trace {
    Off = 0,
    Messages = 1,
    Verbose = 2
}
export declare type TraceValue = 'off' | 'messages' | 'verbose';
export declare namespace Trace {
    function fromString(value: string): Trace;
}
export default class Tracer {
    private readonly trace;
    constructor(trace: Trace);
    logTrace(serverId: string, message: string, data?: any): void;
}
//# sourceMappingURL=tracer.d.ts.map