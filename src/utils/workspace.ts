import { homedir } from 'os';
import * as fastGlob from 'fast-glob'
import { Analyzer } from '../analyze';
import { createReadStream } from 'fs';
import { toLspDocument } from './translation';
import { LspDocument } from '../document';

/**
 * call to initialize all workspaces in the fish-lsp-config,
 * @TODO: or the use the defaults set by the configManager
 */
export async function initializeFishWorkspaces(config?: {}) {
    const spaces = new FishWorkspaces();
    Workspace.MAX_FILE_AMOUNT = 5000;
    const defaultWorkspaces = [
        `${homedir}/.config/fish`,
        `/usr/share/fish`,
    ]
    const canRename = [
        `${homedir}/.config/fish`,
    ]
    for (const path of defaultWorkspaces) {
        const newWS = await createWorkspace(path);
        if (canRename.includes(path)) {
            newWS.canRename = true;
        }
        spaces.add(newWS)
    }
    return spaces
}

/**
 * @internal For testing purposes.
 * call to initialize a single workspace. 
 *
 * Use workspaces.addWorkspace() to add a workspace to the
 * process-wide workspaces object.
 */
export async function createWorkspace(path: string) {
    const workspace = new Workspace(path);
    await workspace.initializeFiles();
    return workspace;
}


/**
 * Helper function to get all files in workspace.
 * Adding completions to this list increases time exponentially.
 *
 * @link https://nodejs.org/api/stream.html#stream_readable_streams
 * @link https://github.com/mrmlnc/fast-glob#readme
 *
 * @return {Promise<Map<string, LspDocument>>} Map of file uris to file contents.
 * convert back to Map<string, string> 
 */
export async function getFilesStream(path: string, maxFilesAmount: number = 5000): Promise<Map<string, LspDocument>> {
    const filesMap: Map<string, LspDocument> = new Map<string, LspDocument>();

    const stream = fastGlob.stream(['functions/*.fish', '**.fish'], {
        //extglob: true,
        absolute: true,
        onlyFiles: true,
        globstar: true,
        cwd: path,
        braceExpansion: true,
        deep: 2,
        ignore: ['completions'],
        followSymbolicLinks: false,
        suppressErrors: true,
    })

    // NOTE: we use a stream here to not block the event loop
    // and ensure that we stop reading files if the glob returns
    // too many files.
    let i = 0
    for await (const fileEntry of stream) {
        if (i >= maxFilesAmount) {
            // NOTE: Close the stream to stop reading files paths.
            stream.emit('close')
            break
        }
        const filename = fileEntry.toString()
        const content = await new Promise<string>((resolve, reject) => {
            const chunks: string[] = [];
            createReadStream(filename)
                .on("data", (chunk) => chunks.push(chunk.toString()))
                .on("end", () => resolve(chunks.join("")))
                .on("error", reject);
        });
        const doc = toLspDocument(filename, content);
        filesMap.set(filename, doc)
        i++
    }
    return filesMap
}

export class Workspace {

    public static MAX_FILE_AMOUNT = 5000;

    public path: string ;
    public autoloaded: boolean = false;
    public canRename: boolean = false;

    public documents: Map<string, LspDocument> = new Map<string, LspDocument>();

    constructor(name: string) {
        this.path = name;
        this.autoloaded = false;
        this.canRename = false;
    }

    public async initializeFiles() {
        const allFiles = await getFilesStream(this.path);
        for (const [file, contents] of allFiles.entries()) {
            this.documents.set(file, contents);
        }
    }

    contains(uri: string) {
        return this.path === uri ||
            this.documents.has(uri) ||
            this.documents.has("file://" + uri)
    }
    setCanRename() {
        this.canRename = true;
    }
    getfileContents(uri: string) {
        return this.documents.get(uri);
    }
    get files() : string[] {
        return Array.from(this.documents.keys());
    }
    get docs() : LspDocument[] {
        return Array.from(this.documents.values());
    }
    get functions(): LspDocument[] {
        return this.docs.filter(doc => doc.isFunction) || []
    }
}


/**
 * @see LspDocuments in ../document.ts
 *
 * Similiar to LspDocuments, except that for clarity and simplicity, LspDocuments stores
 * opened documents in the client. FishWorkspaces stores all workspaces analyzed by the 
 * server.
 *
 * Currently does not open a file/uri, but rather just stores the reachable uri's for a
 * given workspace. 
 *
 * Consider moving Analyzer.initiateBackgroundAnalysis to this class.
 */
export class FishWorkspaces {
    //static fileAmount = 5000;
    public _workspaces: Workspace[] = [];
    add(workspace: Workspace) {
        this._workspaces.push(workspace);
    }
    find(uri: string) {
        return this._workspaces.find((workspace: Workspace) => workspace.contains(uri));
    }
    get workspaces() {
        return this._workspaces;
    }
    get workspaceNames() {
        return this._workspaces.map((workspace: Workspace) => workspace.path);
    }
    get workspaceDocs() {
        return this._workspaces.map((workspace: Workspace) => workspace.docs).flat();
    }
    get editable() {
        return this.workspaces
            .filter(workspace => workspace.canRename);
    }
    get autoloaded() {
        return this.workspaces
            .filter(workspace => workspace.autoloaded);
    }
    clear() {
        this._workspaces = []
    }
}

