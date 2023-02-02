import { homedir } from 'os';
import * as fastGlob from 'fast-glob'
import { Analyzer } from '../analyze';

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

    public static async init(name: string) {
        const curr = new Workspace(name)
        await curr.setFiles();
        return curr;
    }

    /**
     * Helper function to get all files in workspace.
     *
     * {@link https://nodejs.org/api/stream.html#stream_readable_streams | NodeJS Readable Stream}
     * {@link https://github.com/mrmlnc/fast-glob#readme | FastGlob }
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

    private async setFiles() {
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

    hasFunction(uri: string) {
        if (uri.endsWith('config.fish')) return true
        return this.contains(uri) && uri.includes('/functions/')
    }

    hasCompletion(uri: string) {
        return this.contains(uri) && uri.includes('/completions/')
    }

    // don't care about completions
    isAutoloadedSymbol(uri: string) {
        return this.autoloaded ? this.hasFunction(uri) : false
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
}


export class FishWorkspaces {

    static fileAmount = 5000;
    static workspaces: Set<Workspace> = new Set();

    //initializeObject: {fileAmount?: number, workspaces?: string[], editableWorkspaces: string[]}
    static async init() {
        //initializeObject.editableWorkspaces = initializeObject.editableWorkspaces || [];
        FishWorkspaces.setDefaultWorkspaces();
        FishWorkspaces.setEdiableWorkspaces(`${homedir()}/.config/fish`);
        return FishWorkspaces;
    }

    static async setDefaultWorkspaces() {
        await FishWorkspaces.addWorkspace(
            `${homedir()}/.config/fish`,
            `/usr/share/fish`,
        );
    }

    static async addWorkspace(...workspaces: string[]) {
        for (const name of workspaces) {
            const workspace = await Workspace.init(name);
            this.workspaces.add(workspace);
        }
    }

    static getEditableWorkspaces() {
        return Array
            .from(this.workspaces)
            .filter(workspace => workspace.editable);
    }

    static setEdiableWorkspaces(...workspaces: string[]) {
        for (const workspace of workspaces) {
            const editableWorkspace = this.getWorkspace(workspace);
            if (editableWorkspace) {
                editableWorkspace.setEditable();
            } else {
                throw new Error(`Workspace ${workspace} not found`);
            }
        }
    }

    static getAllFilePaths() {
        const allFiles : string[] = [];
        for (const workspace of FishWorkspaces.workspaces) {
            allFiles.push(...workspace.files)
        }
        return allFiles;
    }

    static getWorkspace(uri: string) {
        return Array
            .from(this.workspaces)
            .find(workspace => workspace.contains(uri));
    }

    static getAllWorkspacePaths() {
        return Array
            .from(this.workspaces)
            .map(workspace => workspace.path);
    }

    static clear() {
        FishWorkspaces.workspaces.clear();
    }
}

export async function initializeFishWorkspaces() {
    return await FishWorkspaces.init();
}
