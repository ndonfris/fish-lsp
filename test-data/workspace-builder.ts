
import { readFileSync } from 'fs';
import { LspDocument } from '../src/document';
import { homedir } from 'os';
import { resolve } from 'path';
import * as fastGlob from 'fast-glob'
import Parser from 'web-tree-sitter';
import { TextDocumentItem } from 'vscode-languageserver';
import { pathToUri, uriToPath } from '../src/utils/translation';
import { FishWorkspace, Workspace } from '../src/utils/workspace';

export type WorkspaceName = 'workspace_1' | 'workspace_2' | 'workspace_3'

export class WorkspaceSpoofer implements FishWorkspace {

    public name: WorkspaceName
    public path: string
    public actualPath: string
    public files: SpoofedFile[]
    public uris: Set<string>

    public static async create(workspaceName: WorkspaceName) {
        const actualPath = getTestDirectory(workspaceName)
        const files = await getAllSpoofedFiles(actualPath)
        return new WorkspaceSpoofer(workspaceName, actualPath, files)

    }

    private constructor(workspaceName: WorkspaceName, actualPath: string, files: SpoofedFile[]) {
        //super(`${homedir()}/.config/fish`, new Set([...files].map(file => file.fakePath)))
        this.name = workspaceName
        this.path = `${homedir()}/.config/fish`
        this.actualPath = actualPath
        this.files = files
        this.uris = new Set(files.map(file => file.uri));
    }

    get count() {
        return this.files.length
    }

    contains(...checkUris: string[]) {
        for (const uri of checkUris) {
            const uriAsPath = uriToPath(uri)
            if (!uriAsPath.startsWith(this.path)) return false
        }
        return true
    }

    findMatchingFishIdentifiers(fishIdentifier: string) {
        const matches: string[] = []
        const toMatch = `/${fishIdentifier}.fish`
        for (const uri of this.uris) {
            if (uri.endsWith(toMatch)) {
                matches.push(uri)
            }
        }
        return matches
    }

    urisToLspDocuments(): LspDocument[] {
        const docs: LspDocument[] = []
        for (const file of this.files) {
            docs.push(file.toLspDocument())
        }
        return docs
    }

    getDocument(uri: string) {
        return this.urisToLspDocuments().find(doc => doc.uri === uri)
    }

    forEachLspDocument(callback: (doc: LspDocument) => void) {
        for (const doc of this.urisToLspDocuments()) {
            callback(doc)
        }
    }

    forEach(callback: (doc: LspDocument) => void) {
        for (const doc of this.urisToLspDocuments()) {
            callback(doc)
        }
    }

    filter(callbackfn: (lspDocument: LspDocument) => boolean): LspDocument[] {
        const result: LspDocument[] = []
        for (const doc of this.urisToLspDocuments()) {
            if (callbackfn(doc)) result.push(doc)
        }
        return result
    }
}


export class SpoofedFile {
    public realPath: string
    public fakePath: string
    public relativePath: string
    public uri: string

    constructor(realPath: string) {
        this.realPath = realPath
        this.relativePath = getRelativePath(realPath)
        this.fakePath = spoofRelavtivePath(this.relativePath)
        this.uri = pathToUri(this.fakePath)
    }

    get content() {
        return readFileSync(this.realPath).toString()
    }

    toLspDocument() {
        const doc = TextDocumentItem.create(this.uri, 'fish', 0, this.content)
        return new LspDocument(doc)
    }


}

function getTestDirectory(workspaceName: WorkspaceName) {
    return resolve(__dirname, 'workspaces', `${workspaceName}`, 'fish')
}

/**
 * @param {string} relativePath -  path to file into ~/.config/fish/<HERE> 
 */
function spoofRelavtivePath(relativePath: string) {
    return `${homedir()}/.config/fish/${relativePath}`
}

function getRelativePath(realPath: string) {
    return realPath.split('fish/')[1]
}

export async function getAllFiles(workspaceDir: string) {
    const stream = fastGlob.stream('**/*.fish', {cwd: workspaceDir, absolute: true})
    const result: string[] = []
    for await (const entry of stream) {
        const absPath = entry.toString()
        result.push(absPath)
    }
    return result
}

export async function getAllSpoofedFiles(workspaceDir: string) {
    const stream = fastGlob.stream('**/*.fish', {cwd: workspaceDir, absolute: true})
    const result: SpoofedFile[] = []
    for await (const entry of stream) {
        const absPath = entry.toString()
        const spoofedFile = new SpoofedFile(absPath)
        result.push(spoofedFile)
    }
    return result
}