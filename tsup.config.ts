
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    server: 'src/server.ts'
  }, // Adjust this to your actual entry file(s)
  outDir: 'out',
  format: ['cjs'], // CommonJS format is typically used for Node.js applications
  splitting: false, // Since it's a Node.js app, code splitting might not be necessary
  sourcemap: true, // If you want sourcemaps for debugging
  clean: true, // Cleans the output directory before building


  // You might not need to directly specify the files from `out/**/*.js` here,
  // assuming they are required/imported by your TypeScript files.
});