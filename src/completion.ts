import {CompletionItem, CompletionList} from 'vscode-languageserver-protocol';
import {SyntaxNode} from 'web-tree-sitter';


// utils create CompletionResolver and CompletionItems
// also decide which completion icons each item will have
// try to get clean implementation of {...CompletionItem.create(), item: desc}


// • include pipe completions
// • include escape character completions
// • 
// • 
export class Completion {

    private currentNode: SyntaxNode | undefined;
    private commandNode: SyntaxNode | undefined;

    private globalVariableList: CompletionItem[] | undefined;
    private abbrList: CompletionItem[] | undefined;
    private localVariablesList: CompletionItem[] | undefined;
    private localFunctions: CompletionItem[] | undefined;

    private isInsideCompletionsFile: boolean = false;

    private completions: CompletionItem[] = [];
    private isIncomplete: boolean = false;

    constructor() {
        this.isIncomplete = false;
        this.completions = []
        this.isInsideCompletionsFile = false; 
    }

    // call in server.initialize()
    // also you could add the syntaxTree on 
    // this.documents.listener.onDocumentChange(() => {})
    public async initialDefaults() {
        this.globalVariableList = [];
        this.abbrList = []
    }

    // here you build the completion data per type
    // call enrichCompletions on new this.completions
    // therefore you probably want to add the defaults (abbr & global variable list)
    // after this.completions is enriched
    private enrichCompletions() {

    }


    // probably need some of SyntaxTree class in this file
    public async generate() {



        return CompletionList.create(this.completions, this.isIncomplete)

    }



    // create (atleast) two methods for generating completions, 
    //      1.) with a syntaxnode -> allows for thorough testing
    //      2.) with a params -> allows for fast implementation to server
    //                        -> this also needs to work for server.onHover()
    //      3.) with just text -> allows for extra simple tests
    // 
    //






}





















