import { homedir } from 'os';
import * as fastGlob from 'fast-glob'
import { Analyzer } from '../analyze';
import { create } from 'domain';

async function createWorkspace(path: string) {
    const workspace = new Workspace(path);
    await workspace.initializeFiles();
    return workspace;
}

export class Workspace {

    public static MAX_FILE_AMOUNT = 5000;

    public path: string ;
    public autoloaded: boolean;
    public editable: boolean;

    public _files: Set<string> = new Set();
    private _functions:   Set<string> = new Set<string>();
    private _completions: Set<string> = new Set<string>();

    constructor(name: string) {
        this.path = name;
        this.autoloaded = false;
        this.editable = false;
    }

    /**
     * Helper function to get all files in workspace.
     *
     * @link https://nodejs.org/api/stream.html#stream_readable_streams
     * @link https://github.com/mrmlnc/fast-glob#readme
     *
     * @return {Promise<string[]>} Array of file paths.
     */
    private async getFilesStream(): Promise<string[]> {
        const stream = fastGlob.stream(['**.fish'], {
            absolute: true,
            onlyFiles: true,
            globstar: true,
            cwd: this.path,
            deep: 2,
            followSymbolicLinks: false,
            suppressErrors: true,
        })

        // NOTE: we use a stream here to not block the event loop
        // and ensure that we stop reading files if the glob returns
        // too many files.
        const files: string[] = []
        let i = 0
        for await (const fileEntry of stream) {
            if (i >= Workspace.MAX_FILE_AMOUNT) {
                // NOTE: Close the stream to stop reading files paths.
                stream.emit('close')
                break
            }

            files.push(fileEntry.toString())
            i++
        }
        return files
    }

    public async initializeFiles() {
        const allFiles = await this.getFilesStream()
        for (const file of allFiles) {
            this._files.add(file)
            const autoloadName = file.slice(file.lastIndexOf('/') + 1, file.lastIndexOf('.fish'))
            if (file.includes('/functions/')) this._functions.add(autoloadName)
            if (file.includes('/completions/')) this._completions.add(autoloadName)
        }
    }

    contains(uri: string) {
        //const uriPath = uri.startsWith('file://') ? uriToPath(uri) || uri : uri;
        return (
            this._files.has(uri) ||
            this._files.has("file://" + uri) ||
            this.path.startsWith(uri.slice(0, this.path.lastIndexOf("/"))) ||
            this.path.startsWith(uri.slice("file://".length + 1, this.path.lastIndexOf("/")))
        );
    }

    setEditable() {
        this.editable = true;
    }
    get files() {
        return Array.from(this._files);
    }
    get functions() {
        return Array.from(this._functions);
    }
    get completions() {
        return Array.from(this._completions);
    }
    get functionNames() {
        return Array.from(
            this.functions.map((func: string) => {
                const startIndex = func.lastIndexOf("/") + 1
                const endIndex = func.lastIndexOf(".fish");
                return func.slice(startIndex, endIndex)
            })
        );
    }
}


export class FishWorkspaces {

    static fileAmount = 5000;
    protected workspaces: Map<string, Workspace> = new Map();

    //initializeObject: {fileAmount?: number, workspaces?: string[], editableWorkspaces: string[]}
    async init(initializationnObject: {}) {
        //initializeObject.editableWorkspaces = initializeObject.editableWorkspaces || [];
        await this.setDefaultWorkspaces();
        this.setEdiableWorkspaces(`${homedir()}/.config/fish`);
        return this;
    }

    async setDefaultWorkspaces() {
        await this.addWorkspace(
            `${homedir()}/.config/fish`,
            `/usr/share/fish`,
        );
    }

    async addWorkspace(...workspaces: string[]) {
        for (const name of workspaces) {
            const workspace = await createWorkspace(name)
            this.workspaces.set(name, workspace);
        }
    }

    getEditableWorkspaces() {
        return Array
            .from(this.workspaces.values())
            .filter(workspace => workspace.editable);
    }

    setEdiableWorkspaces(...workspaces: string[]) {
        for (const workspace of workspaces) {
            const editableWorkspace = this.getWorkspace(workspace);
            if (editableWorkspace) {
                editableWorkspace.setEditable();
            } else {
                throw new Error(`Workspace ${workspace} not found`);
            }
        }
    }

    getAllFilePaths() {
        const allFiles : string[] = [];
        for (const workspace of this.workspaces.values()) {
            allFiles.push(...workspace.files)
        }
        return allFiles;
    }

    getWorkspace(uri: string) {
        return Array
            .from(this.workspaces.values())
            .find(workspace => workspace.contains(uri));
    }

    getAllWorkspacePaths() {
        return Array
            .from(this.workspaces.values())
            .map(workspace => workspace.path);
    }

    clear() {
        this.workspaces.clear();
    }
}

export async function initializeFishWorkspaces() {
    const workspaces = new FishWorkspaces();
    return await workspaces.init({});
}
