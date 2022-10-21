import { TextDocument } from 'vscode-languageserver-textdocument';
export declare const FISH_LOCATIONS: {
    configFile: string;
    config: {
        completions: string;
        functions: string;
    };
    builtins: {
        completions: string;
        functions: string;
    };
};
export declare function getFishTextDocumentsFromStandardLocations(): Promise<TextDocument[]>;
export declare function readFishDir(dir: string): Promise<string[]>;
export declare function getAllFishLocations(): Promise<string[]>;
//# sourceMappingURL=locations.d.ts.map