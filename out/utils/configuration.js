"use strict";
/*
 * Copyright (C) 2021.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FishServerLogLevel = void 0;
/* eslint-disable @typescript-eslint/no-unnecessary-qualifier */
//import { Logger } from './logger';
//import { LspClient } from '../lsp-client';
var FishServerLogLevel;
(function (FishServerLogLevel) {
    FishServerLogLevel[FishServerLogLevel["Off"] = 0] = "Off";
    FishServerLogLevel[FishServerLogLevel["Normal"] = 1] = "Normal";
    FishServerLogLevel[FishServerLogLevel["Terse"] = 2] = "Terse";
    FishServerLogLevel[FishServerLogLevel["Verbose"] = 3] = "Verbose";
})(FishServerLogLevel = exports.FishServerLogLevel || (exports.FishServerLogLevel = {}));
(function (FishServerLogLevel) {
    function fromString(value) {
        switch (value === null || value === void 0 ? void 0 : value.toLowerCase()) {
            case 'normal':
                return FishServerLogLevel.Normal;
            case 'terse':
                return FishServerLogLevel.Terse;
            case 'verbose':
                return FishServerLogLevel.Verbose;
            case 'off':
            default:
                return FishServerLogLevel.Off;
        }
    }
    FishServerLogLevel.fromString = fromString;
    function toString(value) {
        switch (value) {
            case FishServerLogLevel.Normal:
                return 'normal';
            case FishServerLogLevel.Terse:
                return 'terse';
            case FishServerLogLevel.Verbose:
                return 'verbose';
            case FishServerLogLevel.Off:
            default:
                return 'off';
        }
    }
    FishServerLogLevel.toString = toString;
})(FishServerLogLevel = exports.FishServerLogLevel || (exports.FishServerLogLevel = {}));
//export interface FishServiceConfiguration {
//    //readonly logger: Logger;
//    //readonly lspClient: LspClient;
//    readonly tsserverLogVerbosity: FishServerLogLevel;
//    readonly tsserverPath?: string;
//}
//# sourceMappingURL=configuration.js.map