/**
 * text: actual completion text
 * description: fish shell compleiton description
 *
 * bind        (Handle fish key binding)
 * text          description --> note: no parenthesis when outside of interactive shell
 *
 * Descriptions are optionally because things like function files will not show any
 * description, however we will indcate it empty string
 */
export interface CmdLineCmp {
    text: string;
    description: string;
}
export declare function createFishBuiltinComplete(arr: string[]): CmdLineCmp;
//# sourceMappingURL=completionItemFactory.d.ts.map