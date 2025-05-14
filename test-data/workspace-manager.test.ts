
import { createFakeUriPath, setLogger } from './helpers';
import { WorkspaceManager } from '../src/utils/workspace-manager';
import { env } from '../src/utils/env-manager';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { AnalyzedWorkspace, AnalyzeWorkspacePromise, initializeDefaultFishWorkspaces, Workspace, workspaces } from '../src/utils/workspace';
import { config, ConfigSchema } from '../src/config';
import { pathToUri, uriToPath, uriToReadablePath } from '../src/utils/translation';
import { AnalyzedDocument, Analyzer } from '../src/analyze';
import { initializeParser } from '../src/parser';
import * as Parser from 'web-tree-sitter';
import { promises } from 'fs';
import { AsyncFileHelper, SyncFileHelper } from '../src/utils/file-operations';
import { LspDocument } from '../src/document';

let workspaceManager: WorkspaceManager;
let parser: Parser;
let analyzer: Analyzer;

describe('workspace-manager tests', () => {
  setLogger();

  beforeEach(async () => {
    await setupProcessEnvExecFile();
    Object.assign(config, ConfigSchema.parse({}));
    while (workspaces.length > 0) {
      workspaces.pop();
    }
    workspaceManager = new WorkspaceManager();
    await initializeDefaultFishWorkspaces();
    parser = await initializeParser();
    analyzer = new Analyzer(parser);
  });

  it.skip('should create a workspace manager', async () => {
    const workspaceManager = new WorkspaceManager();;
    workspaces.forEach((workspace) => {
      workspaceManager.addWorkspace(workspace);
      // console.log({
      //   workspaceManagerSize: workspaceManager.workspaces.length,
      // });
    });
    workspaceManager.setCurrent(workspaces[0]!);
    const newUri = createFakeUriPath('/tmp/foo.fish');
    const newWorkspace = Workspace.syncCreateFromUri(newUri);
    if (!newWorkspace) {
      console.log({
        error: 'No workspace found',
      });
      fail();
    }
    workspaceManager.setCurrent(newWorkspace);
    // console.log({
    //   current: workspaceManager.current?.uri.toString(),
    //   workspaceManagerSize: workspaceManager.workspaces.length,
    //   // didUpdate,
    // });
    workspaceManager.removeWorkspace(workspaceManager.current!);
    // console.log({
    //   current: workspaceManager.current?.uri.toString(),
    //   workspaceManagerSize: workspaceManager.workspaces.length,
    // })
    expect(workspaceManager.workspaces).toHaveLength(2);
    const { didUpdate } = workspaceManager.updateCurrentFromUri(newUri);
    console.log({
      current: workspaceManager.current?.uri.toString(),
      workspaceManagerSize: workspaceManager.workspaces.length,
      didUpdate,
      paths: workspaceManager.allWorkspacePaths,
      namesToAnalyze: workspaceManager.getWorkspacesToAnalyze().map(w => w.name),
    });
    // expect(workspaceManager.current?.uri.toString()).toBe(newUri.toString());
    expect(workspaceManager.workspaces).toHaveLength(3);
    // expect(workspaceManager).toBeDefined();
    console.log({
      ordered: workspaceManager.orderedWorkspaces().map(w => w.uri.toString()),
      workspaces: workspaceManager.workspaces.map(w => w.uri.toString()),
    });
    // workspaceManager.allNewUrisToAnalyze().documentUris.forEach((uri, idx) => {
    //   console.log({
    //     uri: uriToReadablePath(uri),
    //     idx: idx,
    //   })
    // })
    console.log(workspaceManager.allNewUrisToAnalyze().documentUris.length);
    const start = performance.now();
    const workspaceItems = Object.keys(workspaceManager.allNewUrisToAnalyze().items);
    const results: AnalyzedDocument[] = [];
    // for await (const uri of workspaceItems) {
    //
    Promise.race(workspaceItems.map(async (uri) => {
      const workspace = workspaceManager.findWorkspace(uri);
      if (!workspace) return [];
      return await Promise.all(workspace.allUnanalyzedUris.map(async (uri) => {
        workspace.analyzedUri(uri);
        const filePath = uriToPath(uri);
        // const fileContent = AsyncFileHelper.isReadable(filePath)
        // if (!fileContent) {
        //   const doc = LspDocument.createTextDocumentItem(filePath, '');
        return Promise.resolve(analyzer.analyzePath(filePath)).then((r) => {
          results.push(r);
          return r;
        });
      })).then((resolve) => resolve);
      //   console.log('r', r);
      // } else {

      // }
    }));
    // Promise.allworkspacePromises.then((res) => {
    //   results.push(...res);
    // });


    //   console.log({
    //     res: res.map(r => r.document.uri),
    //   })
    // });

    // console.log('res', res);
    // console.log('results', results);

    // const res = await Promise.all(workspacePromises.map(async (promise) => promise));
    // results.push(...res);
    // }));
    let idx = 0;
    // const items = await Promise.all(promiseArr.map(workspacePromises => 
    //   Promise.all(workspacePromises)
    // ));
    for (const item of results) {
      if (idx === 10) {
        console.log('10', item);
      }
      idx++;
    }
    // const items = promiseArr.map(async (item) => console.log(await item));
    // console.log(items.length, {
    //   item_10: items.at(10)?.toString(),
    // });
    // await Promise.all(promiseArr);
    // await Promise.all(promiseArr);
    const end = performance.now();
    console.log({
      time: (end - start) / 1000,
      items: workspaceManager.workspaces.map(w => ({
        ws: w.name.toString(),
        uris: w.allAnalyzedUris.length,
        unanalyzed: w.allUnanalyzedUris.length,
      }))
    });
    expect(true).toBeTruthy();
  });

  it("test 2", async () => {
    const workspaceManager = new WorkspaceManager();;
    workspaces.forEach((workspace, index) => {
      workspaceManager.addWorkspace(workspace);
      // if (index === 0) {
      // }
    });
    const initTime = performance.now();
    // const allPromises = [];
    const newUri = createFakeUriPath('/tmp/foo.fish');
    const newWorkspace = Workspace.syncCreateFromUri(newUri);
    if (!newWorkspace) fail();
    workspaceManager.addWorkspace(newWorkspace);
    workspaceManager.setCurrent(newWorkspace);
    // console.log({ size: allPromises.length });

    // const allPromises = workspaces.map(async (workspace) => {
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    // const allPromises = workspaceManager.orderedWorkspaces()
    //   // .filter(workspace => workspace.needsAnalysis())
    //   .map(async workspace => {
    //     const startTime = performance.now();
    //     return await analyzer.analyzeWorkspaceNew(workspace).then((res) => {
    //       const endTime = performance.now();
    //       // console.log({
    //       //   time: ((endTime - startTime) / 1000).toFixed(2),
    //       //   count: res,
    //       //   workspace: workspace.name.toString(),
    //       // });
    //       return {
    //         time: ((endTime - startTime) / 1000).toFixed(2),
    //         count: res,
    //         workspace: workspace,
    //       };
    //     });
    //   });
    //
    // let totalItems = 0;
    // allPromises.forEach((promise, idx) => {
    //   promise.then((res) => {
    //     console.log({
    //       idx: idx,
    //       time: res.time,
    //       items: res.workspace.allAnalyzedUris.length,
    //       count: res.count,
    //       workspace: res.workspace.name.toString(),
    //     })
    //     totalItems += res.count;
    //   });
    // });
    // await Promise.all(allPromises);
    const { totalItems, items } = await analyzer.analyzeAllWorkspacesNew(workspaceManager.orderedWorkspaces());
    // await analyzer.analyzeAllWorkspacesNew(workspaceManager.workspaces).workspacePromises.forEach(({ promise, name }) => {
    //   promise.then((result) => {
    //     console.log(`result ${result.filesParsed} name: ${result.workspace.name}`);
    //   })
    // })
    // allPromises.forEach(promise => {
    //   promise.then(() => {})
    //     
    //     // console.log({ res });
    //     // res.forEach((result) => {
    //     //   result.then((r: {time: number, count: number, workspace: string}) => {
    //     //     console.log({
    //     //       time: r.time,
    //     //       items: r?.count,
    //     //       workspace: r?.workspace,
    //     //     });
    //     //   });
    //     // });
    //   // });
    // });
    // const {  workspacePromises, allCompleted } = analyzer.analyzeAllWorkspacesNew(workspaceManager.workspaces);
    // workspacePromises.forEach(({promise, name}) => {
    //   promise.then((result) => {
    //     console.log(`result ${result.filesParsed} name: ${result.workspace.name}`);
    //   })
    // })
    // res?.workspacePromises.forEach((promise) => {
    //   promise.then((r) => {
    //     console.log('r', r);
    //   });
    // })
    // console.log({res})
    // })

    // const workspacePromises = workspaceManager.orderedWorkspaces().map(async (workspace) => {
    //   const startTime = performance.now();
    //   const docs = await workspace.unanalyzedUrisToLspDocuments();
    //   if (workspace.name.endsWith('/tmp/foo.fish')) {
    //     await delay(3000);
    //   }
    //   docs.forEach((doc) => {
    //     workspace.analyzedUri(doc.uri);
    //     analyzer.analyze(doc);
    //   });
    //   const endTime = performance.now();
    //   return {
    //     time: ((endTime - startTime) / 1000).toFixed(2),
    //     items: docs.map(r => r.uri).slice(0, 10),
    //     count: docs.length,
    //     workspace: workspace.name.toString(),
    //   };
    // });
    // await Promise.all(workspacePromises).then((res) => {
    //   res.forEach((r) => {
    //     console.log({
    //       time: r.time,
    //       items: r?.items,
    //       count: r?.count,
    //       workspace: r?.workspace,
    //     });
    //   })
    // })

    // workspaceManager.orderedWorkspaces().forEach((workspace) => {
    //   const startTime = performance.now();
    //   Promise.resolve(workspace.unanalyzedUrisToLspDocuments()).then((docs) => {
    //     if (workspace.name.endsWith('/tmp/foo.fish')) {
    //       delay(3000);
    //     }
    //     docs.forEach((doc) => {
    //       workspace.analyzedUri(doc.uri);
    //       analyzer.analyze(doc);
    //     });
    //     const endTime = performance.now();
    //     allPromises.push({
    //       time: ((endTime - startTime) / 1000).toFixed(2),
    //       items: docs.map(r => r.uri).slice(0, 10),
    //       count: docs.length,
    //       workspace: workspace.name.toString(),
    //     });
    //   })
    // })

    // const result = await Promise.all(promises);
    // for (const r of result) {
    //   console.log({
    //     time: r.time,
    //     items: r?.items,
    //     count: r?.count,
    //     workspace: r?.workspace,
    //   });
    // }
    // }
    // await Promise.allSettled(allPromises.map(async (promise) => await Promise.all(promise)))
    // await Promise.allSettled(allPromises.map(async (promise) => {
    //   const startTime = performance.now();
    //   const results: AnalyzedWorkspace = await Promise.all(await promise.result());
    //   const endTime = performance.now();
    //   console.log({
    //     time: ((endTime - startTime) / 1000).toFixed(2),
    //     items: results.map(r => r.doc.uri).slice(0, 10),
    //     workspace: promise.workspace.name.toString(),
    //   });
    // }));

    // for await (const workspace of workspaces) {
    //   allPromises.push(new Promise(resolve => resolve(workspace.analyze(analyzer))));
    // }
    // await Promise.allSettled(allPromises).then((res) => {
    //   console.log('res', res);
    // })
    const finalTime = performance.now();
    console.log({
      totalTime: ((finalTime - initTime) / 1000).toFixed(2),
      count: totalItems,
      items: workspaceManager.workspaces.map(w => ({
        ws: w.name.toString(),
        analyzedUris: w.allAnalyzedUris.length,
        unanalyzedUris: w.allUnanalyzedUris.length,
      }))
    });
    // const workspacePromises = workspaces.map(async workspace =>
    //   await Promise.all(workspace.allUnanalyzedUris.map(async uri => new Promise(async (resolve) => {
    //     const doc = await LspDocument.createFromUriAsync(uri);
    //     workspace.analyzedUri(uri);
    //     resolve(analyzer.analyze(doc));
    //   })))
    //   // await Promise.all(workspace.allUnanalyzedUris.map(async uri => {
    //   //   const doc = await LspDocument.createFromUriAsync(uri);
    //   //   analyzer.analyze(doc);
    //   //   workspace.analyzedUri(uri);
    //   // }));
    // );
    // await Promise.all(workspacePromises);
    // const endTime = performance.now();
    // console.log({
    //   time: (endTime - startTime) / 1000,
    //   items: workspaceManager.workspaces.map(w => ({
    //     ws: w.name.toString(),
    //     uris: w.allAnalyzedUris.length,
    //     unanalyzed: w.allUnanalyzedUris.length,
    //   }))
    // });

  });

  it.only('updating uri', async () => {
    const workspaceManager = new WorkspaceManager();;
    workspaces.forEach((workspace, index) => {
      workspaceManager.addWorkspace(workspace);
      // if (index === 0) {
      // }
    });
    const initTime = performance.now();
    // const allPromises = [];
    const newUri = createFakeUriPath('/tmp/foo.fish');
    workspaceManager.updateCurrentFromUri(newUri);
    console.log({
      size: workspaceManager.workspaces.length,
      current: workspaceManager.current?.uri.toString(),
      paths: workspaceManager.allWorkspacePaths,
      namesToAnalyze: workspaceManager.getWorkspacesToAnalyze().map(w => w.name),
    })
    await analyzer.analyzeAllWorkspacesNew(workspaceManager.orderedWorkspaces());
  })


  // it.only('should create a workspace from a path', async () => {
  //   const workspaceManager = new WorkspaceManager();;
  //   const initTime = performance.now();
  //   workspaces.forEach((workspace, index) => {
  //     if (index === 1) {
  //       workspaceManager.addWorkspace(workspace);
  //       workspaceManager.setCurrent(workspace);
  //     }
  //     // if (index === 0) {
  //     // }
  //   });
  //   console.log(workspaceManager.workspaces.length);
  //   await analyzer.analyzeWorkspaceNew(workspaceManager.current!);
  //   console.log({
  //     duration: ((performance.now() - initTime) / 1000).toFixed(2),
  //   });
  //
  // });
  //
  // it.only('should create a workspace from a path', async () => {
  //   const workspaceManager = new WorkspaceManager();;
  //   const initTime = performance.now();
  //   workspaces.forEach((workspace) => {
  //     workspaceManager.addWorkspace(workspace);
  //     workspaceManager.setCurrent(workspace);
  //     // if (index === 0) {
  //     // }
  //   });
  //   console.log(workspaceManager.workspaces.length);
  //   await analyzer.analyzeAllWorkspacesNew(workspaces);
  //   console.log({
  //     duration: ((performance.now() - initTime) / 1000).toFixed(2),
  //   });
  // });
});
