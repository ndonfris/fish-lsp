import { LspDocument } from './document'
import { createTextDocumentFromFilePath } from './utils/io';
import { TextDocuments } from 'vscode-languageserver';

export class LspDocuments {

    // consider changing to a map or an object with the keyof syntax
    private readonly _files: string[] = [];

    private readonly openDocuments: Map<string, LspDocument>;

    // 
    public documents: Map<string, LspDocument>;
    public dependencies: Map<string, LspDocument[]>;

    constructor() {
        this.openDocuments = new Map<string, LspDocument>();
        this.documents = new Map<string, LspDocument>();
        this.dependencies = new Map<string, LspDocument[]>();
    }

    /**
     * gets the dependency for the the file/uri passed in
     *
     * @param {string} file - the file to find in the documents.
     * @returns {LspDocument | undefined} - the document found matching 
     *                                      the uri if it exists
     */
    get(file: string): LspDocument | undefined {
        const uri = file
        const document = this.documents.get(uri);
        if (!document) {
            return undefined;
        }
        return document;
    }                

    /**
     * normalizes a filepaths uri, and creates the textDocument. Also, sets the
     * dependencies for a newDocument.
     */
    async newDocument(uri: string) {
        const document = await createTextDocumentFromFilePath(uri)
        if (!document) {
            return
        }
        this.documents.set(uri, document)
        this.dependencies.set(uri, [])
    }

    getDependencies(uri: string) {
        const deps = this.dependencies.get(uri)
        if (!deps) {
            return [] as LspDocument[]
        }
        return deps
    }

    /**
     * add a new Dependency, to the document
     * @param {string} uri - the uri that has a dependency
     * @param {string} depUri - the uri that is the depency
     */
    public addDependency(uri: string, depUri: string) {
        const newDep = this.get(depUri);
        if (newDep) {
            const oldDeps = this.getDependencies(uri)
            this.dependencies.set(uri, [...oldDeps, newDep]);
        }
    }


    /**
     * checks if a uri is open for a document
     */
    isOpen(uri: string) : boolean {
        return this._files.filter(openUri => openUri == uri).length > 0
    }

    /**
     * return all the documents seen in the _files field
     */
    getOpenDocuments(): LspDocument[] {
        const result: LspDocument[] = [];
        for (const docUri of this._files) {
            const doc = this.get(docUri)
            if (doc) {
                result.push(doc)
            }
        }
        return result;
    }

    /**
     * adds a new Uri to the _files array. Returns true if a document is opened
     * and false if a document is already opened
     */
    async open(uri: string): Promise<boolean> {
        if (this.isOpen(uri)) {
            return false;
        }
        if (!this.get(uri)) {
            await this.newDocument(uri)
        }
        this._files.unshift(uri);
        return true;
    }

    /**
     * deletes an item from the _files array, and returns the document
     */
    close(uri: string): LspDocument | undefined {
        const document = this.documents.get(uri);
        if (!document) {
            return undefined;
        }
        this._files.splice(this._files.indexOf(uri), 1)
        return document;
    }
}
