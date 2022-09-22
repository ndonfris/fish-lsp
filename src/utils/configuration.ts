/*
 * Copyright (C) 2021.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

/* eslint-disable @typescript-eslint/no-unnecessary-qualifier */

import { Logger } from '../utils/logger';
import { LspClient } from '../lsp-client';

export enum FishServerLogLevel {
    Off,
    Normal,
    Terse,
    Verbose,
}

export namespace FishServerLogLevel {
    export function fromString(value: string): FishServerLogLevel {
        switch (value?.toLowerCase()) {
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

    export function toString(value: FishServerLogLevel): string {
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
}

export interface FishServiceConfiguration {
    readonly logger: Logger;
    readonly lspClient: LspClient;
    readonly tsserverLogVerbosity: FishServerLogLevel;
    readonly tsserverPath?: string;
}
