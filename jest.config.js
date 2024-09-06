'use-strict';
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  collectCoverage: false,
  transform: {
    "^.+\\.(t|j)s$": ["ts-jest", { isolatedModules: true }],
  },
  testMatch: [
    '**/test-data/*.test.ts'
  ],
  // globals: {
  testPathIgnorePatterns: [
    "/node_modules/"
  ],
  // roots: [
  //   "<rootDir>/src",
  //   "<rootDir>/test-data"
  // ],
  // detectLeaks: true,
  // clearMocks: true,
  // skipNodeResolution: true,
  
  watchPlugins: [
    'jest-watch-typeahead/filename',
    'jest-watch-typeahead/testname',
  ],
  
  

  //   'ts-jest': {
  //     isolatedModules: true
  //   }
  // },
};
