import * as LSP from 'vscode-languageserver';
import { MessageType } from 'vscode-languageserver';
import { attachWorkDone } from 'vscode-languageserver/lib/common/progress.js';
import { FishRenameRequest } from './commands';
import { FishProtocol } from './utils/fishProtocol';

export interface WithProgressOptions {
    message: string;
    reporter: LSP.WorkDoneProgressReporter;
}

export interface LspClient {
    createProgressReporter(token?: LSP.CancellationToken, workDoneProgress?: LSP.WorkDoneProgressReporter): Promise<LSP.WorkDoneProgressReporter>;
    withProgress<R>(options: WithProgressOptions, task: (progress: LSP.WorkDoneProgressReporter) => Promise<R>): Promise<R>;
    publishDiagnostics(args: LSP.PublishDiagnosticsParams): void;
    showErrorMessage(message: string): void;
    logMessage(args: LSP.LogMessageParams): void;
    applyWorkspaceEdit(args: LSP.ApplyWorkspaceEditParams): Promise<LSP.ApplyWorkspaceEditResult>;
    rename(args: LSP.TextDocumentPositionParams): Promise<any>;
}

// Hack around the LSP library that makes it otherwise impossible to differentiate between Null and Client-initiated reporter.
const nullProgressReporter = attachWorkDone(undefined as any, /* params */ undefined);

export class LspClientImpl implements LspClient {
    constructor(protected connection: LSP.Connection) {}

    async createProgressReporter(_?: LSP.CancellationToken, workDoneProgress?: LSP.WorkDoneProgressReporter): Promise<LSP.WorkDoneProgressReporter> {
        let reporter: LSP.WorkDoneProgressReporter;
        if (workDoneProgress && workDoneProgress.constructor !== nullProgressReporter.constructor) {
            reporter = workDoneProgress;
        } else {
            reporter = workDoneProgress || await this.connection.window.createWorkDoneProgress();
        }
        return reporter;
    }

    async withProgress<R = unknown>(options: WithProgressOptions, task: (progress: LSP.WorkDoneProgressReporter) => Promise<R>): Promise<R> {
        const { message, reporter } = options;
        reporter.begin(message);
        return task(reporter).then(result => {
            reporter.done();
            return result;
        });
    }

    publishDiagnostics(params: LSP.PublishDiagnosticsParams): void {
        this.connection.sendDiagnostics(params);
    }

    showErrorMessage(message: string): void {
        this.connection.sendNotification(LSP.ShowMessageNotification.type, { type: MessageType.Error, message });
    }

    logMessage(args: LSP.LogMessageParams): void {
        this.connection.sendNotification(LSP.LogMessageNotification.type, args);
    }

    async applyWorkspaceEdit(params: LSP.ApplyWorkspaceEditParams): Promise<LSP.ApplyWorkspaceEditResult> {
        return this.connection.workspace.applyEdit(params);
    }

    async rename(args: LSP.TextDocumentPositionParams): Promise<any> {
        return this.connection.sendRequest(FishRenameRequest.type, args);
    }
}

