import { Analyzer, analyzer } from '../src/analyze';
import { LspDocument } from '../src/document';
import { nodesGen, pointToPosition } from '../src/utils/tree-sitter';
import { createMockConnection, setupStartupMock } from './helpers';
import TestWorkspace from './test-workspace-utils';

// Setup startup mocks before importing FishServer
setupStartupMock();

// Now import FishServer after the mock is set up
import FishServer from '../src/server';
import { initializeParser } from '../src/parser';
import { AutoloadedPathVariables, setupProcessEnvExecFile } from '../src/utils/process-env';
import { env } from '../src/utils/env-manager';
// import { SyncFileHelper } from '../src/utils/file-operations';
import path from 'path';
import fs from 'fs';

describe('embedded:functions/*.fish lookup', () => {
  let server: FishServer;
  beforeAll(async () => {
    await setupProcessEnvExecFile();
    await initializeParser();
    await Analyzer.initialize();

    // Create mock connection
    const mockConnection = createMockConnection();
    const mockInitializeParams = {
      processId: 1234,
      rootUri: 'file:///test/workspace',
      rootPath: '/test/workspace',
      capabilities: {
        workspace: {
          workspaceFolders: true,
        },
        textDocument: {
          completion: {
            completionItem: {
              snippetSupport: true,
            },
          },
        },
      },
      workspaceFolders: [],
    };
    const result = await FishServer.create(mockConnection, mockInitializeParams as any);
    server = result.server;
    server.backgroundAnalysisComplete = true; // Enable completions
  });
  const TEST_WORKSPACE_1 = TestWorkspace.create({ name: 'embedded-functions-resolution' })
    .addFiles(
      {
        relativePath: 'functions/my_test.fish',
        content: [
          'function my_test',
          '    fish_add_path $__fish_data_dir',
          '    echo "Embedded function executed"',
          'end',
        ],
      },
      {
        relativePath: 'functions/other_test.fish',
        content: [
          'function other_test',
          '    fish_add_path $__fish_data_dir',
          '    echo "other test function executed"',
          'end',
        ],
      },
      {
        relativePath: 'test_script.fish',
        content: [
          '#!/usr/bin/env fish',
          'source functions/my_test.fish',
          'source functions/other_test.fish',
          'my_test',
          'other_test',
          'funced my_test',
          'alias f=my_test',
        ],
      },
    ).initialize();

  let myTestDoc: LspDocument;
  let otherTestDoc: LspDocument;
  let testScriptDoc: LspDocument;

  beforeAll(async () => {
    await setupProcessEnvExecFile();
    await initializeParser();
    await Analyzer.initialize();

    myTestDoc = TEST_WORKSPACE_1.find('functions/my_test.fish')!;
    otherTestDoc = TEST_WORKSPACE_1.find('functions/other_test.fish')!;
    testScriptDoc = TEST_WORKSPACE_1.find('test_script.fish')!;
  });

  it('verify documents loaded', () => {
    expect(myTestDoc).toBeDefined();
    expect(otherTestDoc).toBeDefined();
    expect(testScriptDoc).toBeDefined();
  });

  it('should resolve embedded functions correctly', () => {
    const { document: doc, root } = analyzer.analyze(myTestDoc).ensureParsed();
    const cmdNode = nodesGen(root).find(n => n.text === 'fish_add_path')!;
    console.log(cmdNode.text);
    const location = analyzer.getDefinitionLocation(doc, pointToPosition(cmdNode.startPosition));
    console.log({
      location,
    });
    const potentialPaths: string[] = [];
    for (const autoloadedVar of env.getAutoloadedKeys()) {
      if (env.getAsArray(autoloadedVar)?.length === 0) {
        continue;
      }
      if (autoloadedVar === 'fish_complete_path') {
        continue;
      }
      if (autoloadedVar === 'fish_function_path') {
        env.getAsArray(autoloadedVar).forEach(p => {
          potentialPaths.push(path.join(p, 'fish_add_path.fish'));
        });
        continue;
        // } else if (autoloadedVar === 'fish_user_paths') {
        //   env.getAsArray(autoloadedVar).forEach(p => {
        //     potentialPaths.push(path.join(p, 'functions', 'fish_add_path.fish'));
        //   });
        //   continue;
      }
      if (env.getAsArray(autoloadedVar).length === 1) {
        const value = env.getFirstValueInArray(autoloadedVar);
        potentialPaths.push(path.join(`${value}`, 'functions', 'fish_add_path.fish'));
      }
    }
    console.log({
      potentialPaths,
    });
    // env.getAutoloadedKeys().forEach(k => {
    //   // console.log({
    //   //   k,
    //   //   v: SyncFileHelper.expandEnvVars(`$${k}`),
    //   // })
    //   if (SyncFileHelper.exists(SyncFileHelper.expandEnvVars(path.join(`$${k}`, 'functions', 'fish_add_path.fish')))) {
    //     console.log(`Found fish_add_path.fish in $${k}`);
    //   }
    //   // console.log(SyncFileHelper.exists(SyncFileHelper.expandEnvVars(path.join(`$${k}`, 'functions', 'fish_add_path.fish'))))
    //   // console.log(SyncFileHelper.expandEnvVars(path.join(`$${k}`, 'functions', 'fish_add_path.fish')));
    // });
    console.log(AutoloadedPathVariables.findAutoloadedFunctionPath('fish_add_path'));
  });

  it.only('should resolve my_test function definition', () => {
    const { document: doc, commandNodes, root } = analyzer.analyze(myTestDoc).ensureParsed();
    const cmdNode = nodesGen(root).find(n => n.text === 'fish_add_path')!;
    console.log({
      doc: {
        uri: doc.uri,
        path: doc.path,
      },
      cmdNode: {
        text: cmdNode.text,
        startPosition: cmdNode.startPosition,
      },
    });
    // const location = analyzer.getDefinitionLocation(doc, pointToPosition(cmdNode.startPosition));
    const files: string[] = [];
    env.getAsArray('__fish_data_dir').forEach(p => {
      console.log('data dir entry:', p);
      files.push(path.join(p, 'functions', 'fish_add_path.fish'));
    });
    env.getAsArray('__fish_sysconfdir').forEach(p => {
      console.log('sysconfdir entry:', p);
      files.push(path.join(p, 'functions', 'fish_add_path.fish'));
    });
    env.getAsArray('__fish_sysconf_dir').forEach(p => {
      console.log('sysconf_dir entry:', p);
      files.push(path.join(p, 'functions', 'fish_add_path.fish'));
    });
    env.getAsArray('__fish_vendor_functionsdirs').forEach(p => {
      console.log('vendor functions dir entry:', p);
      files.push(path.join(p, 'fish_add_path.fish'));
    });
    env.getAsArray('fish_function_path').forEach(p => {
      console.log('fish_function_path entry:', p);
      files.push(path.join(p, 'fish_add_path.fish'));
    });
    env.getAsArray('__fish_config_dir').forEach(p => {
      console.log('config dir entry:', p);
      files.push(path.join(p, 'functions', 'fish_add_path.fish'));
    });
    let i = 0;
    for (const f of files) {
      console.log({ f, i });
      i++;
      if (fs.existsSync(f)) {
        console.log('Found file at path:', f);
        break;
      }
    }
    // files.forEach(f => {
    //   console.log('checking file:', f);
    // })
  });

  it.only('should resolve fish_add_path function definition path', () => {
    const { document: doc, root } = analyzer.analyze(myTestDoc).ensureParsed();
    const cmdNode = nodesGen(root).find(n => n.text === 'fish_add_path')!;
    console.log({
      doc: {
        uri: doc.uri,
        path: doc.path,
      },
      text: cmdNode.text,
    });
    // const location = analyzer.getDefinitionLocation(doc, pointToPosition(cmdNode.startPosition));
    console.log(env.findAutoloadedFunctionPath(cmdNode.text!).at(0));
    analyzer.getDefinitionLocation(myTestDoc, pointToPosition(cmdNode.startPosition));
  });
});
