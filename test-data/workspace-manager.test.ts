import { createFakeLspDocument, fishLocations, FishLocations, setLogger } from './helpers';
import { LspDocument, documents } from '../src/document';
import { Analyzer } from '../src/analyze';
import { workspaceManager } from '../src/utils/workspace-manager';
import * as path from 'path';
import { mkdirSync, rm, writeFileSync } from 'fs';
import { Workspace } from '../src/utils/workspace';
import { pathToUri } from '../src/utils/translation';
let locations: FishLocations;
describe('new-workspace-manager', () => {
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

  beforeAll(async () => {
    locations = await fishLocations();
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

  // beforeEach(async () => {
  //   parser = await initializeParser();
  //   analyzer = new Analyzer(parser);
  //   documents.clear();
  //   for (const { dirpath, docs } of testWorkspaceSkeleton) {
  //     const workspace = Workspace.syncCreateFromUri(pathToUri(dirpath))!;
  //     workspaceManager.addWorkspace(workspace);
  //     docs.forEach((doc) => {
  //       workspace.addUri(doc.uri);
  //       documents.open(doc);
  //     });
  //   }
  //   workspaces.copy(workspaceManager);
  //   // await analyzer.initiateBackgroundAnalysis()
  // });

  beforeEach(async () => {
    await Analyzer.initialize();
    documents.clear();
    workspaceManager.clear();
  });

  afterEach(() => {
    documents.clear();
    workspaceManager.clear();
  });

  describe('setup 1', () => {
    beforeEach(() => {
      workspaceManager.clear();
      documents.clear();
      testWorkspaceSkeleton.forEach(({ dirpath, docs }) => {
        const newWorkspace = Workspace.syncCreateFromUri(pathToUri(dirpath));
        if (!newWorkspace) {
          throw new Error(`Failed to create workspace from ${dirpath}`);
        }
        workspaceManager.add(newWorkspace);
        docs.forEach((doc) => {
          newWorkspace.uris.add(doc.uri);
        });
      });
    });

    it('check length', () => {
      expect(workspaceManager.all).toHaveLength(4);
    });

    it('check ws 1', async () => {
      const ws1 = workspaceManager.all.at(0)!;
      const focusedDoc = ws1.allDocuments().at(0)!;
      // console.log({
      //   ws1: {
      //     uri: ws1.uri,
      //     uris: ws1.uris,
      //     focusedDoc: focusedDoc.uri,
      //     isFocusedDoc: LspDocument.is(focusedDoc),
      //   }
      // });

      workspaceManager.handleOpenDocument(focusedDoc);
      expect(workspaceManager.current).toEqual(ws1);
      // console.log({
      //   documents: documents.all().map((doc) => doc.uri),
      //   analyzedUris: ws1.allAnalyzedUris,
      //   unanalyzedUris: ws1.allUnanalyzedUris,
      //   allUris: ws1.allUris,
      // });
      const ws2 = workspaceManager.all.at(1)!;
      let focusedDoc2 = ws2.allDocuments().at(0)!;
      workspaceManager.handleOpenDocument(focusedDoc2);
      documents.applyChanges(focusedDoc2.uri, [
        {
          text: [focusedDoc2.getText(), `source ${focusedDoc.path}`].join('\n'),
        },
      ]);
      focusedDoc2 = documents.getDocument(focusedDoc2.uri)!;
      workspaceManager.handleUpdateDocument(focusedDoc2);
      console.log({
        ws2: {
          uri: ws2.uri,
          uris: ws2.uris,
          focusedDoc: focusedDoc2.uri,
          isFocusedDoc: LspDocument.is(focusedDoc2),
          openedDocs: documents.openDocuments.map((doc) => doc.uri),
        },
      });
      workspaceManager.handleCloseDocument(focusedDoc2);
      // console.log({
      //   documents: documents.all().map((doc) => doc.uri),
      //   currentWS: workspaceManager.current?.uri,
      // });
      expect(documents.all().map((doc) => doc.uri)).toHaveLength(1);
      expect(workspaceManager.current).toEqual(ws1);
    });

    it('didChangeWorkspace', () => {
      const ws1 = workspaceManager.all.at(0)!;
      const focusedDoc = ws1.allDocuments().at(0)!;
      workspaceManager.handleOpenDocument(focusedDoc);
      expect(workspaceManager.current).toEqual(ws1);
      const ws2 = workspaceManager.all.at(1)!;
      const ws3 = workspaceManager.all.at(2)!;
      const ws4 = workspaceManager.all.at(3)!;
      workspaceManager.handleWorkspaceChangeEvent({
        added: [
          {
            uri: ws2.uri,
            name: ws2.name,
          },
          {
            uri: ws3.uri,
            name: ws3.name,
          },
          {
            uri: ws4.uri,
            name: ws4.name,
          },
        ],
        removed: [
          {
            uri: ws1.uri,
            name: ws1.name,
          },
        ],
      });
      workspaceManager.setCurrent(ws4);
      expect(workspaceManager.current).toEqual(ws4);
    });

    it('check ws __fish_config_dir', async () => {
      const workspaces = [
        ...workspaceManager.all,
        Workspace.syncCreateFromUri(locations.uris.fish_config.dir)!,
        Workspace.syncCreateFromUri(locations.uris.fish_data.dir)!,
        Workspace.syncCreateFromUri(locations.uris.test_workspace.dir)!,
      ];
      workspaceManager.clear();
      workspaces.forEach((ws) => {
        workspaceManager.add(ws);
      });

      // const newWorkspace = Workspace.syncCreateFromUri(locations.uris.fish_config.dir)!;
      // workspaceManager.add(newWorkspace);
      // workspaceManager.handleOpenDocument(newWorkspace.allDocuments().at(0)!);
      const result = await workspaceManager.analyzePendingDocuments();
      console.log({
        items: Object.entries(result.items).map(([key, value]) => ({
          key,
          value: value.length,
        })),
        total: result.totalDocuments,
      });
      workspaceManager.handleOpenDocument(locations.uris.fish_config.config);
      workspaceManager.handleOpenDocument(locations.uris.fish_data.config);
      workspaceManager.handleCloseDocument(locations.uris.fish_data.config);
    });
  });
});
