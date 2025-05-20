
import { createFakeUriPath, fishLocations, setLogger, FishLocations, createFakeLspDocument } from './helpers';
import { WorkspaceManager } from '../src/utils/workspace-manager';
import { initializeDefaultFishWorkspaces, Workspace } from '../src/utils/workspace';
import { workspaces } from '../src/utils/workspace-manager';
import { config, ConfigSchema } from '../src/config';
import { pathToUri, uriToPath, uriToReadablePath } from '../src/utils/translation';
import { AnalyzedDocument, Analyzer } from '../src/analyze';
import { initializeParser } from '../src/parser';
import * as Parser from 'web-tree-sitter';
import { documents, LspDocument } from '../src/document';
import * as path from 'path';
import { DocumentUri } from 'vscode-languageserver';
import { mkdirSync, promises, rm, rmdir, rmdirSync, writeFileSync } from 'fs';
import { logger } from '../src/logger';
import { SyncFileHelper } from '../src/utils/file-operations';

let workspaceManager: WorkspaceManager;
let parser: Parser;
let analyzer: Analyzer;
let locations: FishLocations = {} as FishLocations;

describe('workspace-manager tests', () => {
  setLogger();

  beforeAll(async () => {
    locations = await fishLocations();
  });

  beforeEach(async () => {
    // await setupProcessEnvExecFile();
    Object.assign(config, ConfigSchema.parse({}));
    while (workspaces.workspaces.length > 0) {
      workspaces.workspaces.pop();
    }
    workspaceManager = new WorkspaceManager();
    await initializeDefaultFishWorkspaces();
    parser = await initializeParser();
    analyzer = new Analyzer(parser);
  });

  it.skip('test 2', async () => {
    const workspaceManager = new WorkspaceManager();
    workspaces.workspaces.forEach((workspace) => {
      workspaceManager.addWorkspace(workspace);
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
    const { totalFilesParsed } = await analyzer.initiateBackgroundAnalysis();
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
      count: totalFilesParsed,
      items: workspaceManager.workspaces.map(w => ({
        ws: w.name.toString(),
        analyzedUris: w.allAnalyzedUris.length,
        unanalyzedUris: w.allUnanalyzedUris.length,
      })),
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

  // it.only('updating uri', async () => {
  //   const workspaceManager = new WorkspaceManager();;
  //   workspaces.workspaces.forEach((workspace, index) => {
  //     workspaceManager.addWorkspace(workspace);
  //     // if (index === 0) {
  //     // }
  //   });
  //   const initTime = performance.now();
  //   // const allPromises = [];
  //   const newUri = createFakeUriPath('/tmp/foo.fish');
  //   workspaceManager.updateCurrentFromUri(newUri);
  //   console.log({
  //     size: workspaceManager.workspaces.length,
  //     current: workspaceManager.current?.uri.toString(),
  //     paths: workspaceManager.allWorkspacePaths,
  //     namesToAnalyze: workspaceManager.getWorkspacesToAnalyze().map(w => w.name),
  //   });
  //   await analyzer.analyzeAllWorkspacesNew(workspaceManager.orderedWorkspaces());
  // });

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

  describe.skip('many workspaces piled together', () => {
    let pathToTestWorkspace: string;
    let newUri: string;
    let newDocUri: string;
    let newWorkspace: Workspace;
    let docs: LspDocument[] = [];
    // const pathToDefaultFishConfig = path.join(env.getAsArray('__fish_config_dir')!.at(0)!, 'config.fish');
    // const uriToDefaultFishConfig = pathToUri(pathToDefaultFishConfig);

    beforeEach(async () => {
      pathToTestWorkspace = locations!.paths!.test_workspace!.dir!;
      newUri = locations.uris.test_workspace.dir;
      newDocUri = locations.uris.test_workspace.config;
      newWorkspace = Workspace.syncCreateFromUri(newUri)!;
      // newWorkspace = (await Workspace.createFromUri(newUri))!;
      // newWorkspace = Workspace.syncCreateFromUri(newUri)!;
      workspaceManager = new WorkspaceManager();
      // create the initial workspaces
      workspaces.orderedWorkspaces().forEach((workspace) => {
        workspaceManager.addWorkspace(workspace);
        workspaceManager.current = workspace;
        docs.push(...workspace.allDocuments());
      });

      // create the new workspace
      workspaceManager.addWorkspace(newWorkspace);
      workspaceManager.current = newWorkspace;
      docs.push(...newWorkspace.allDocuments());
      analyzer = new Analyzer(parser);
      workspaces.copy(workspaceManager);
      documents.clear();
    }, 2000);

    afterEach(() => {
      workspaceManager.clear();
      workspaces.clear();
      docs = [];
    });

    it('setup workspaces testing', () => {
      expect(workspaceManager.workspaces).toHaveLength(3);
      expect(newWorkspace).toBeDefined();
      expect(newWorkspace.name.toString()).toBe(pathToTestWorkspace);
      expect(docs.find(d => d.uri === newDocUri)).toBeDefined();
      expect(newWorkspace.path).toBe(pathToTestWorkspace);
      expect(workspaceManager.current?.name.toString()).toBe(pathToTestWorkspace);
      // console.log({
      //   documents: docs.map(d => d.uri.toString()),
      // });
    });

    it('workspace history length 3, remove workspaces', () => {
      // make sure we have 3 workspaces
      expect(workspaceManager.workspaces).toHaveLength(3);

      // remove each of the 3 workspaces
      let lastWorkspace = workspaceManager.removeLast()!;
      expect(workspaceManager.workspaces).toHaveLength(2);
      expect(workspaceManager.current?.name.toString()).toBe('__fish_data_dir');
      expect(lastWorkspace.path).toBe(pathToTestWorkspace);

      lastWorkspace = workspaceManager.removeLast()!;
      expect(workspaceManager.workspaces).toHaveLength(1);
      expect(workspaceManager.current?.name.toString()).toBe('__fish_config_dir');
      expect(lastWorkspace.name).toBe('__fish_data_dir');

      lastWorkspace = workspaceManager.removeLast()!;
      expect(workspaceManager.workspaces).toHaveLength(0);
      expect(workspaceManager.current).toBeUndefined();
      expect(lastWorkspace.name).toBe('__fish_config_dir');

      // add a new workspace
      const foundWorkspace = workspaceManager.updateCurrentFromUri(newUri);
      expect(foundWorkspace).toBeDefined();
    });

    it('test initialize background fast', async () => {
      let totalItems = 0;
      const startTime = performance.now();
      await Promise.all(docs.map(async (doc) => {
        if (doc.getAutoloadType() === 'completions') {
          analyzer.analyzePartial(doc);
        } else {
          analyzer.analyze(doc);
        }
        const workspace = workspaceManager.findContainingWorkspace(doc.uri);
        if (workspace) workspace.analyzedUri(doc.uri);
        totalItems++;
      }));
      const endTime = performance.now();
      console.log({
        time: `${((endTime - startTime) / 1000).toFixed(2)} seconds`,
        items: totalItems,
        workspaces: workspaceManager.workspaces.map(w => ({
          name: uriToReadablePath(w.uri.toString()),
          uris: w.uris.size,
          analyzed: w.allAnalyzedUris.length,
          unanalyzed: w.allUnanalyzedUris.length,
          needsAnalysis: w.needsAnalysis(),
          isAnalyzed: w.isAnalyzed(),
        })),
      });
      console.log({ totalItems });
    });

    describe.skip('removing from workspaces', () => {
      it('test removing w/ uri', async () => {
        let totalItems = 0;
        await Promise.all(docs.map(async (doc) => {
          if (doc.getAutoloadType() === 'completions') {
            analyzer.analyzePartial(doc);
          } else {
            analyzer.analyze(doc);
          }
          const workspace = workspaceManager.findContainingWorkspace(doc.uri);
          if (workspace) workspace.analyzedUri(doc.uri);
          totalItems++;
        }));
        const currentDoc = docs.find(d => d.uri === newDocUri)!;

        const urisInWorkspace = analyzer.cache.uris().filter(uri => newWorkspace.contains(uri));
        console.log({
          totalItems,
        });

        const urisNotInOtherWorkspaces = urisInWorkspace.filter(uri => {
          return !workspaces.workspaces.some((workspace) => {
            if (workspace.uri === newWorkspace.uri) return false;
            if (workspace.uris.has(uri)) {
              console.log({
                uri: uriToReadablePath(uri.toString()),
                workspace: workspace.name.toString(),
              });
              return true;
            }
            return false;
          });
        });

        const removedUris: string[] = [];
        for (const uri of urisNotInOtherWorkspaces) {
          analyzer.cache.clear(uri);
          removedUris.push(uri.toString());
        }

        console.log({
          urisInWorkspace: urisInWorkspace.map(uri => uriToReadablePath(uri.toString())).length,
          urisNotInOtherWorkspaces: urisNotInOtherWorkspaces.map(uri => uriToReadablePath(uri.toString())).length,
          currentDoc: currentDoc.uri.toString(),
          currentDocPath: uriToReadablePath(currentDoc.uri.toString()),
          currentDocName: currentDoc.getFilename(),
          removedUris: removedUris.length,
        });
        analyzer.clearEntireWorkspace(newWorkspace, documents);
      });

      it('test removing w/o uri', async () => {
        let totalItems = 0;
        workspaces.current?.addUri(locations.uris.fish_config.config);
        // workspaces.current?.addUri(uriToDefaultFishConfig)
        await Promise.all(docs.map(async (doc) => {
          if (doc.getAutoloadType() === 'completions') {
            analyzer.analyzePartial(doc);
          } else {
            analyzer.analyze(doc);
          }
          const workspace = workspaceManager.findContainingWorkspace(doc.uri);
          if (workspace) workspace.analyzedUri(doc.uri);
          totalItems++;
        }));
        // const currentDoc = documents.find(d => d.uri === newDocUri)!;

        const urisInWorkspace = analyzer.cache.uris().filter(uri => newWorkspace.contains(uri));
        console.log({
          totalItems,
        });

        const urisNotInOtherWorkspaces = urisInWorkspace.filter(uri => {
          return !workspaces.workspaces.some((workspace) => {
            if (workspace.uri === newWorkspace.uri) return false;
            if (workspace.uris.has(uri)) {
              console.log({
                uri: uriToReadablePath(uri.toString()),
                workspace: workspace.name.toString(),
              });
              return true;
            }
            return false;
          });
        });

        const removedUris: string[] = [];
        for (const uri of urisNotInOtherWorkspaces) {
          analyzer.cache.clear(uri);
          removedUris.push(uri.toString());
          docs = docs.filter(d => d.uri !== uri);
        }
        const removedSymbols = new Map<DocumentUri, string[]>();
        for (const symbol of analyzer.globalSymbols.allSymbols) {
          if (urisNotInOtherWorkspaces.some(uri => uri === symbol.uri)) {
            analyzer.globalSymbols.map.delete(symbol.name);
            const otherSymbolsInUri = removedSymbols.get(symbol.uri) || [];
            otherSymbolsInUri.push(symbol.name);
            removedSymbols.set(symbol.uri, otherSymbolsInUri);
          }
        }

        console.log({
          urisInWorkspace: urisInWorkspace.map(uri => uriToReadablePath(uri.toString())).length,
          urisNotInOtherWorkspaces: urisNotInOtherWorkspaces.map(uri => uriToReadablePath(uri.toString())).length,
          removedUris: removedUris.length,
          totalUris: docs.length,
          removedSymbols: Array.from(removedSymbols.entries()).map(([uri, symbols]) => ({
            uri: uriToReadablePath(uri.toString()),
            symbols: symbols.join(','),
            total: symbols.length,
          })),
        });
      });

      it('clear analyzer w/ single doc in workspace', async () => {
        let totalItems = 0;
        let currentDoc: LspDocument | undefined;
        await Promise.all(docs.map(async (doc) => {
          if (doc.getAutoloadType() === 'completions') {
            analyzer.analyzePartial(doc);
          } else {
            analyzer.analyze(doc);
          }
          const workspace = workspaceManager.findContainingWorkspace(doc.uri);
          if (workspace) workspace.analyzedUri(doc.uri);
          totalItems++;
          if (workspace && workspace.uri !== locations.uris.test_workspace.dir) {
            documents.open(doc);
          }
          if (doc.uri === locations.uris.test_workspace.config) {
            documents.open(doc);
            currentDoc = doc;
          }
        }));
        if (!currentDoc) {
          console.log('no current doc');
          fail();
        }
        const openDocsInWorkspace = documents.all().filter(d => newWorkspace.contains(d.uri)).map(d => d.uri.toString());
        expect(openDocsInWorkspace).toHaveLength(1);

        const { removedUris, removedSymbols } = analyzer.clearDocumentFromWorkspace(newWorkspace, documents, currentDoc.uri);
        expect(removedUris).toHaveLength(7);
        expect(removedSymbols).toHaveLength(9);
        // console.log({
        //   single: true,
        //   removedSymbols: removedSymbols.map(s => ({
        //     name: s.name,
        //     path: uriToReadablePath(s.uri.toString()),
        //     uri: s.uri.toString(),
        //     workspace: workspaceManager.findContainingWorkspace(s.uri)?.name.toString(),
        //   })),
        //   length: removedSymbols.length,
        // });
        // console.log({
        //   removedUris: removedUris.length,
        //   removedSymbols: removedSymbols.map(s => ({
        //     name: s.name,
        //     path: uriToReadablePath(s.uri.toString()),
        //     uri: s.uri.toString(),
        //     workspace: workspaceManager.findContainingWorkspace(s.uri)?.name.toString(),
        //   })),
        //   currentDoc: currentDoc.uri.toString(),
        //   currentDocPath: currentDoc.path,
        // });

        // const result = analyzer.clearEntireWorkspace(newWorkspace, documents);
        // console.log({
        //   removedUris: result.removedUris.length,
        //   removedSymbols: result.removedSymbols.length,
        // });
      });

      it('clear analyzer w/ multi docs in workspace', async () => {
        let totalItems = 0;
        let currentDoc: LspDocument | undefined;
        await Promise.all(docs.map(async (doc) => {
          if (doc.getAutoloadType() === 'completions') {
            const res = analyzer.analyzePartial(doc);
            if (res) {
              console.log('res', res.sourceNodes.map(r => r.text));
            }
          } else {
            analyzer.analyze(doc);
          }
          const workspace = workspaceManager.findContainingWorkspace(doc.uri);
          if (workspace) workspace.analyzedUri(doc.uri);
          totalItems++;
          if (workspace && workspace.uri !== locations.uris.test_workspace.dir) {
            documents.open(doc);
          }
          if (doc.path === path.join(locations.paths.test_workspace.functions, 'test-func.fish')) {
            documents.open(doc);
          }
          if (doc.uri === locations.uris.test_workspace.config) {
            documents.open(doc);
            currentDoc = doc;
          }
        }));
        if (!currentDoc) {
          console.log('no current doc');
          fail();
        }
        const openDocsInWorkspace = documents.all().filter(d => newWorkspace.contains(d.uri)).map(d => d.uri.toString());
        expect(openDocsInWorkspace).toHaveLength(2);
        // console.log({
        //   docsInWorkspace: documents.all().filter(d => newWorkspace.contains(d.uri)).map(d => d.uri.toString()),
        // });

        const { removedUris, removedSymbols } = analyzer.clearDocumentFromWorkspace(newWorkspace, documents, currentDoc.uri);
        expect(removedUris).toHaveLength(1);
        expect(removedSymbols).toHaveLength(4);
        // console.log({
        //   removedUris: removedUris.length,
        //   removedSymbols: removedSymbols.map(s => ({
        //     name: s.name,
        //     path: uriToReadablePath(s.uri.toString()),
        //     uri: s.uri.toString(),
        //     workspace: workspaceManager.findContainingWorkspace(s.uri)?.name.toString(),
        //   })),
        //   removedLength: removedSymbols.length,
        //   currentDoc: currentDoc.uri.toString(),
        //   currentDocPath: currentDoc.path,
        // });
      });
    });

    // it('test /tmp/foooo.fish', async () => {
    //   const newUri = createFakeUriPath('/tmp/foooo.fish');
    //   const newDoc = LspDocument.createFromUri(newUri);
    //   // const newWorkspace = Workspace.syncCreateFromUri(newUri);
    //   // if (!newWorkspace) {
    //   //   console.log({
    //   //     error: 'No workspace found',
    //   //   });
    //   //   fail();
    //   // }
    //   workspaceManager.updateCurrentFromUri(newUri);
    //   const res = analyzer.analyze(newDoc);
    //   console.log({
    //     aliases: res.sourceNodes.map(r => r.text),
    //   })
    //   const newSources = Array.from(analyzer.collectAllSources(newUri));
    //   console.log({
    //     newSources: newSources,
    //   })
    //   expect(newSources).toHaveLength(3);
    //   expect(workspaceManager.current?.uri.toString()).toBe(newUri.toString());
    //   expect(workspaceManager.workspaces).toHaveLength(4);
    // })

    it.skip('analyze.initializeBackgroundAnalysis', async () => {
      const { items, totalFilesParsed, workspaces } = await analyzer.initiateBackgroundAnalysis();
      // console.log({
      //   items: Object.entries(items),
      //   totalFilesParsed,
      //   workspaces: workspaces.map(w => ({
      //     name: uriToReadablePath(w.uri.toString()),
      //     uris: w.uris.size,
      //     analyzed: w.allAnalyzedUris.length,
      //     unanalyzed: w.allUnanalyzedUris.length,
      //     needsAnalysis: w.needsAnalysis(),
      //     isAnalyzed: w.isAnalyzed(),
      //   }))
      // });
      expect(Object.entries(items)).toHaveLength(3);
      expect(workspaces).toHaveLength(3);
      const paths = Object.keys(items);
      expect(paths.includes(locations.paths.fish_config.dir)).toBeTruthy();
      expect(paths.includes(locations.paths.fish_data.dir)).toBeTruthy();
      expect(paths.includes(locations.paths.test_workspace.dir)).toBeTruthy();
      expect(items[locations.paths.test_workspace.dir]).toBeGreaterThanOrEqual(7);
      expect(items[locations.paths.fish_config.dir]).toBeGreaterThanOrEqual(0);
      expect(items[locations.paths.fish_data.dir]).toBeGreaterThanOrEqual(25);
      expect(totalFilesParsed).toBeGreaterThanOrEqual(items[locations.paths.test_workspace.dir]! + items[locations.paths.fish_data.dir]!);
    });

    it.skip('workspace history length 3, remove workspaces from analyzer', async () => {
      expect(workspaceManager.workspaces).toHaveLength(3);
      // expect(workspaces.workspaces).toHaveLength(3);
      let totalItems = 0;
      await Promise.all(workspaceManager.orderedWorkspaces().map(async (workspace) => {
        const startTime = performance.now();
        return await analyzer.analyzeWorkspace(workspace).then(() => {
          const endTime = performance.now();
          totalItems += workspace.allAnalyzedUris.length;
          console.log({
            time: ((endTime - startTime) / 1000).toFixed(2),
            items: totalItems,
          });
        });
      }));
      // for await (const workspace of workspaceManager.orderedWorkspaces()) {
      //   const startTime = performance.now();
      //   await analyzer.analyzeWorkspace(workspace);
      //   const endTime = performance.now();
      //   console.log({
      //     time: ((endTime - startTime) / 1000).toFixed(2),
      //     items: workspace.allAnalyzedUris.length,
      //     workspace: workspace.name.toString(),
      //   });
      // }
      // let items = 0;
      // console.log({
      //   testName: 'analyzerTest',
      //   workspaces: workspaceManager.workspaces.map(w => ({ name: w.name, uri: w.uri, size: w.allUris.size })),
      // });
      // (await Promise.all(workspaceManager.workspaces.map(async workspace =>
      //   await analyzer.analyzeWorkspace(workspace)
      // )).then((res) => {
      //   res.forEach((r) => {
      //     items += r.count;
      //   });
      // }));
      // console.log({ items });
      // expect(items).toBeGreaterThan(0);
    });
  });
});

describe.only('testing adding and removing workspaces with overlapping docs', () => {
  setLogger();

  const testWorkspace1Path = path.join('/tmp', 'test_workspace_1');
  const testWorkspace2Path = path.join('/tmp', 'test_workspace_2');
  const testWorkspace3Path = path.join('/tmp', 'test_workspace_3');
  const testWorkspace4Path = path.join('/tmp', 'test_workspace_4');
  const testWorkspaceSkeleton = [
    {
      dirpath: testWorkspace1Path,
      docs: [
        createFakeLspDocument(
          path.join(testWorkspace1Path, 'config.fish'),
          `source ${testWorkspace3Path}/functions/func1.fish`,
          `source ${testWorkspace3Path}/functions/func2.fish`,
          `source ${testWorkspace3Path}/functions/func3.fish`,
          `source ${testWorkspace3Path}/functions/func4.fish`,
        ),
      ],
    },
    {
      dirpath: testWorkspace2Path,
      docs: [
        createFakeLspDocument(
          path.join(testWorkspace2Path, '.env.fish'),
          `source ${testWorkspace3Path}/functions/func1.fish`,
          `source ${testWorkspace3Path}/functions/func2.fish`,
          `source ${testWorkspace3Path}/functions/func3.fish`,
          `source ${testWorkspace3Path}/functions/func4.fish`,
        ),
      ],
    },
    {
      dirpath: testWorkspace3Path,
      docs: [
        createFakeLspDocument(
          path.join(testWorkspace3Path, 'functions', 'func1.fish'),
          'function func1',
          '      echo "func1"',
          'end',
        ),
        createFakeLspDocument(
          path.join(testWorkspace3Path, 'functions', 'func2.fish'),
          'function func2',
          '      echo "func2"',
          'end',
        ),
        createFakeLspDocument(
          path.join(testWorkspace3Path, 'functions', 'func3.fish'),
          'function func3',
          '      echo "func3"',
          ' end',
        ),
        createFakeLspDocument(
          path.join(testWorkspace3Path, 'functions', 'func4.fish'),
          'function func4',
          '     echo "func4"',
          'end',
        ),
      ],
    },
    {
      dirpath: testWorkspace4Path,
      docs: [
        createFakeLspDocument(
          path.join(testWorkspace4Path, 'conf.d', 'load_1.fish'),
          `source ${testWorkspace3Path}/functions/func1.fish`,
        ),
        createFakeLspDocument(
          path.join(testWorkspace4Path, 'conf.d', 'load_2.fish'),
          `source ${testWorkspace3Path}/functions/func2.fish`,
        ),
        createFakeLspDocument(
          path.join(testWorkspace4Path, 'conf.d', 'load_3.fish'),
          `source ${testWorkspace3Path}/functions/func3.fish`,
        ),
        createFakeLspDocument(
          path.join(testWorkspace4Path, 'conf.d', 'load_4.fish'),
          `source ${testWorkspace3Path}/functions/func4.fish`,
        ),
      ],
    },
  ];

  beforeAll(() => {
    workspaceManager = new WorkspaceManager();
    for (const { dirpath, docs } of testWorkspaceSkeleton) {
      mkdirSync(dirpath, { recursive: true });
      // make subdirectories for dirs that use them
      if (![testWorkspace1Path, testWorkspace2Path].includes(dirpath)) {
        ['conf.d', 'functions', 'completions'].forEach((subdir) => {
          const subdirPath = path.join(dirpath, subdir);
          mkdirSync(subdirPath, { recursive: true });
        });
      }
      docs.forEach((doc) => {
        const filepath = doc.path;
        writeFileSync(filepath, doc.getText());
      });
    }
  });

  afterAll(async () => {
    for (const { dirpath } of testWorkspaceSkeleton) {
      rm(dirpath, { recursive: true, force: true }, (err) => { });
    }
  });

  beforeEach(async () => {
    parser = await initializeParser();
    analyzer = new Analyzer(parser);
    workspaceManager = new WorkspaceManager();
    documents.clear();
    for (const { dirpath, docs } of testWorkspaceSkeleton) {
      const workspace = Workspace.syncCreateFromUri(pathToUri(dirpath))!;
      workspaceManager.addWorkspace(workspace);
      docs.forEach((doc) => {
        workspace.addUri(doc.uri);
        documents.open(doc);
      });
    }
    workspaces.copy(workspaceManager);
    // await analyzer.initiateBackgroundAnalysis()
  });

  it.only('test 1', async () => {
    workspaces.workspaces.forEach((workspace) => {
      console.log({
        name: workspace.name.toString(),
        uris: workspace.uris.size,
      });
    });
    workspaceManager.setCurrent(workspaceManager.orderedWorkspaces().at(0)!);
    await Promise.all(documents.all().map(async (doc) => {
      if (doc.getAutoloadType() === 'completions') {
        analyzer.analyzePartial(doc);
      } else {
        analyzer.analyze(doc);
      }
      const workspace = workspaceManager.findContainingWorkspace(doc.uri);
      if (workspace) workspace.analyzedUri(doc.uri);
    }));
    workspaces.current = workspaceManager.orderedWorkspaces().at(1)!;
    documents.all().forEach((doc) => {
      console.log({
        uri: doc.uri,
        text: doc.getText(),
        exists: SyncFileHelper.exists(doc.path),
      });
    });
    console.log({
      workspaces: workspaceManager.workspaces.length,
      current: workspaceManager.current?.name.toString(),
      totalUris: documents.all().length,
    });
    expect(documents.all()).toHaveLength(10);
    analyzer.clearEntireWorkspace(workspaceManager.current!, documents);
    // workspaceManager.removeLast(); // see below about not setting the previous workspace
    console.log({
      workspaces: workspaceManager.workspaces.length,
      current: workspaceManager.current?.name.toString(), // doesn't correctly set the previous workspace
      totalUris: documents.all().length,
    });
    expect(documents.all()).toHaveLength(9);
    expect(true).toBeTruthy();
    // const allSources = analyzer.collectAllSources(pathToUri(path.join(testWorkspace1Path, 'config.fish')));
    // console.log({
    //   allSources: Array.from(allSources),
    // });
    // await analyzer.analyzeWorkspace(workspaceManager.current!);
  });
});

