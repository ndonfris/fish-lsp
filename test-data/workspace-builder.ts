
import { readFileSync } from 'fs';
import { LspDocument } from '../src/document';
import { homedir } from 'os';
import { resolve } from 'path';
import * as fastGlob from 'fast-glob'
import Parser from 'web-tree-sitter';
import { TextDocumentItem } from 'vscode-languageserver';

export type WorkspaceName = 'workspace_1' | 'workspace_2' | 'workspace_3'

export class WorkspaceSpoofer {

    public name: WorkspaceName
    public path: string
    public actualPath: string
    public files: SpoofedFile[]

    public static async create(workspaceName: WorkspaceName) {
        const actualPath = getTestDirectory(workspaceName)
        const files = await getAllSpoofedFiles(actualPath)
        return new WorkspaceSpoofer(workspaceName, actualPath, files)

    }

    private constructor(workspaceName: WorkspaceName, actualPath: string, files: SpoofedFile[]) {
        this.name = workspaceName
        this.path = `${homedir()}/.config/fish`
        this.actualPath = actualPath
        this.files = files
    }

    get count() {
        return this.files.length
    }

    /**
     * Are uris or contents editable in this workspace
     */
    isEditable() {
        return this.path.includes(`${homedir()}/.config/fish`)
    }

    contains(...uris: string[]) {
        for (const uri of uris) {
            if (!this.files.some(file => file.fakePath === uri)) {
                return false
            }
        }
        return true
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
        this.uri = `file://${this.fakePath}`
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