import { assert } from 'chai';
import { homedir } from 'os';
import * as fastGlob from 'fast-glob'
import { getAllFiles, WorkspaceSpoofer } from './workspace-builder';
import { normalizePath, pathToUri, toLspDocument, uriToPath } from '../src/utils/translation';
import { buildUri, setLogger } from './helpers';
import { URI } from 'vscode-uri';
import { Workspace } from '../src/utils/workspace';
import { readFileSync } from 'fs';
import { LspDocument } from '../src/document';

setLogger()

describe("workspace tests", () => {

    const sharePath = '/usr/share/fish'
    it(`workspace: ${sharePath}`, async () => {
        const share = await Workspace.create(sharePath)
        assert.equal(share.isLoadable(), true)
        assert.equal(share.isMutable(), false)
        assert.deepEqual(share.findMatchingFishIdentifiers("ls"), [
            "file:///usr/share/fish/functions/ls.fish",
            "file:///usr/share/fish/completions/ls.fish",
        ]);
    })

    const confPath = `${homedir()}/.config/fish`
    it(`workspace: ${confPath}`, async () => {
        const user = await Workspace.create(confPath)
        assert.equal(user.isLoadable(), true)
        assert.equal(user.isMutable(), true)
        user.add(
            buildWorkspaceUri(confPath, "functions", "ls"),
            buildWorkspaceUri(confPath, "completions", "ls")
        );
        //console.log(user.hasCompletionAndFunction("ls"));
    })

    const workspacePath = `${homedir()}/Downloads/fish`;
    it(`workspace: ${workspacePath}`, async () => {
        const rand = await Workspace.create(workspacePath)
        rand.add(
            buildWorkspaceUri(workspacePath, "functions", "ls"),
            buildWorkspaceUri(workspacePath, "completions", "ls"),
            buildWorkspaceUri(workspacePath, "", "cd"),
        );
        assert.equal(rand.isLoadable(), false)
        assert.equal(rand.isMutable(), true)
        assert.equal(rand.hasCompletionAndFunction("ls"), true)
        assert.equal(rand.findMatchingFishIdentifiers("cd").length, 1)
    })

    const projectPath = `${homedir()}/fish_project`;
    it(`workspace: ${projectPath}`, async () => {
        const proj = await Workspace.create(projectPath)
        proj.add(
            buildWorkspaceUri(projectPath, "", "script_one"),
            buildWorkspaceUri(projectPath, "", "script_two"),
            buildWorkspaceUri(projectPath, "", "script_three"),
        );
        assert.equal(proj.isLoadable(), false)
        assert.equal(proj.isMutable(), true)
        await proj.updateFiles();
        assert.equal(proj.uris.size, 3)
        //proj.uris.forEach((uri) => console.log(uri))
    })

    it(`updating workspace 5 times: ${confPath}`, async () => {
        const user = await Workspace.create(confPath)
        let didUpdate: boolean[] = []
        didUpdate.push(await user.updateFiles())
        didUpdate.push(await user.updateFiles())
        didUpdate.push(await user.updateFiles())
        didUpdate.push(await user.updateFiles())
        didUpdate.push(await user.updateFiles())
        const newIdentifier = '__xyz__xyz__'
        const newUri = buildWorkspaceUri(confPath, 'functions', newIdentifier)
        user.add(newUri)
        assert.isAtLeast(user.uris.size, 1)
        const matches = user.findMatchingFishIdentifiers(newIdentifier)
        assert.equal(matches.length, 1)
        assert.equal(user.contains(newUri), true)
        //console.log(newUri);
    })

    it(`lsp documents for workspace: ${sharePath}`, async () => {
        const share = await Workspace.create(sharePath)
        const docs: LspDocument[] = share.urisToLspDocuments()
        //console.log(docs.length);
        assert.isAbove(docs.length, 1000)
    })
})

function buildWorkspaceUri(workspacePath: string, parentDir: '' | 'functions' | 'completions', file: string) {
    let uriStr = ''
    if (parentDir === '') uriStr = `${workspacePath}/${file}.fish`
    else uriStr = `${workspacePath}/${parentDir}/${file}.fish`
    return buildUri(uriStr)
}
