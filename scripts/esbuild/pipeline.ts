import * as esbuild from 'esbuild';
import { BuildArgs } from './cli';
import { buildConfigs, createBuildOptions } from './configs';
import { generateTypeDeclarations, copyDevelopmentAssets, makeExecutable, showBuildStats } from './utils';
import { logger } from './colors';
import { execSync } from 'child_process';

interface BuildStep {
  name: string;
  priority: number;
  tags: string[]; // What meta-targets include this step
  condition?: (args: BuildArgs) => boolean;
  runner: (args: BuildArgs) => Promise<void> | void;
  timing?: boolean;
  postBuild?: (args: BuildArgs) => Promise<void> | void;
}

class BuildPipeline {
  private steps: BuildStep[] = [];

  register(step: BuildStep): this {
    this.steps.push(step);
    return this;
  }

  async execute(target: string, args: BuildArgs): Promise<void> {
    const applicableSteps = this.getStepsForTarget(target, args);

    if (applicableSteps.length === 0) {
      throw new Error(`No build steps found for target: ${target}`);
    }

    // Show header once at the beginning
    console.log(logger.header('`fish-lsp` esbuild (BUILD SYSTEM)'));
    console.log(logger.info(`Building ${applicableSteps.length} targets...`));

    // Execute all steps with correct numbering
    for (let i = 0; i < applicableSteps.length; i++) {
      const step = applicableSteps[i];
      console.log(`\n${logger.step(i + 1, applicableSteps.length, logger.building(step.name))}`);

      const startTime = Date.now();
      try {
        await step.runner(args);
        if (step.postBuild) {
          await step.postBuild(args);
        }
      } catch (error) {
        console.log(logger.failed(step.name));
        throw error;
      }

      if (step.timing) {
        const buildTime = Date.now() - startTime;
        console.log(logger.success(`✨ ${step.name} built in ${buildTime} ms`));
      }
    }

    console.log(`\n${logger.success('All builds completed successfully!')}`);
  }

  // Get steps for a specific target - useful for other scripts
  getStepsForTarget(target: string, args: BuildArgs): BuildStep[] {
    return this.steps.filter(step => {
      // Direct target match
      if (step.tags.includes(target)) return true;

      // Custom condition
      if (step.condition && step.condition(args)) return true;

      return false;
    }).sort((a, b) => a.priority - b.priority);
  }
  
  // Get all registered steps - useful for introspection
  getAllSteps(): ReadonlyArray<BuildStep> {
    return [...this.steps];
  }
  
  // Check if a target exists
  hasTarget(target: string): boolean {
    return this.steps.some(step => step.tags.includes(target));
  }
}

// Build step definitions
const pipeline = new BuildPipeline()
  .register({
    name: 'Build Time',
    priority: 5,
    tags: ['all', 'dev', 'setup', 'binary', 'npm', 'types', 'lint'],
    timing: true,
    runner: async () => {
      execSync('node ./scripts/build-time', { stdio: 'inherit' });
    },
  })
  .register({
    name: 'Setup Files',
    priority: 10,
    tags: ['all', 'dev', 'setup', 'npm', 'types', 'tests', 'binary', 'lint'],
    timing: true,
    runner: async () => {
      const { buildSetup } = await import('./tasks');
      buildSetup();
    },
  })
  .register({
    name: 'Development',
    priority: 20,
    tags: ['all', 'dev', 'development'],
    timing: true,
    runner: async (args) => {
      const config = buildConfigs.development;
      const buildOptions = createBuildOptions(config, args.production || args.minify, args.sourcemaps);
      await esbuild.build(buildOptions);
    },
    postBuild: async () => {
      copyDevelopmentAssets();
    },
  })
  .register({
    name: 'Universal Binary',
    priority: 30,
    tags: ['all', 'binary', 'dev'],
    timing: true,
    runner: async (args) => {
      const config = buildConfigs.binary;
      const buildOptions = createBuildOptions(config, args.production || args.minify, args.sourcemaps);
      await esbuild.build(buildOptions);
    },
    postBuild: async () => {
      const config = buildConfigs.binary;
      if (config.outfile) {
        makeExecutable(config.outfile);
        showBuildStats(config.outfile, 'Universal Binary');
      }
    },
  })
  .register({
    name: 'NPM Package',
    priority: 40,
    tags: ['all', 'npm', 'dev'],
    timing: true,
    runner: async (args) => {
      const config = buildConfigs.npm;
      const buildOptions = createBuildOptions(config, args.production || args.minify, args.sourcemaps);
      await esbuild.build(buildOptions);
    },
  })
  .register({
    name: 'TypeScript Declarations',
    priority: 50,
    tags: ['all', 'types', 'dev', 'npm'],
    timing: true,
    runner: async () => {
      generateTypeDeclarations();
    },
  })
  .register({
    name: 'Test Suite',
    priority: 60,
    tags: ['test'],
    timing: true,
    runner: async () => {
      execSync('yarn test:run', { stdio: 'inherit' });
    },
  })
  .register({
    name: 'Lint Check',
    priority: 70,
    tags: ['lint'],
    timing: true,
    runner: async () => {
      execSync('yarn lint:fix', { stdio: 'inherit' });
    },
  });

// Export both the pipeline instance and the BuildPipeline class for extensibility
export { pipeline, BuildPipeline, type BuildStep };
