'use-strict';
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^tree-sitter$': '<rootDir>/test-data/tree-sitter-jest.js',
  },
  // transform: { '^.+\.ts?$': ['ts-jest', { isolatedModules: true }] }
  // globals: {
  //   'ts-jest': {
  //     isolatedModules: true
  //   }
  // },
};
