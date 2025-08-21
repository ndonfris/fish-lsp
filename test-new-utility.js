// Quick test of the new findFirstExistingFile utility
const { findFirstExistingFile } = require('./out/utils/path-resolution.js');
const path = require('path');

console.log('Testing findFirstExistingFile utility...');

// Test with some real files in the project
const result = findFirstExistingFile(
  'nonexistent-file.txt',
  path.resolve(__dirname, 'package.json'),
  path.resolve(__dirname, 'tsconfig.json'),
  'another-nonexistent-file.txt'
);

console.log('Found file:', result);
console.log('Expected to find package.json path');

if (result && result.includes('package.json')) {
  console.log('✅ Test passed: Found expected file');
} else {
  console.log('❌ Test failed: Did not find expected file');
}