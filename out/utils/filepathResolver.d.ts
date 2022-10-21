export declare class FilepathResolver {
    fishFunctions: string[];
    userFunctions: string[];
    /** TODO: implement on server config settings */
    otherFunctions: string[];
    static readonly defaultGlobalPath = "/usr/share/fish";
    static readonly defaultUserPath: string;
    private _otherPaths;
    private _allPaths;
    private static instance;
    private constructor();
    static create(...locations: string[]): FilepathResolver;
    isGlobalFishFunction(name: string): boolean;
    isUserFishFunction(name: string): boolean;
    isOtherFishFunction(name: string): boolean;
    getAllpaths(): string[];
}
//# sourceMappingURL=filepathResolver.d.ts.map