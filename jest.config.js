'use-strict';
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.jest.json'
    }],
    // globals: {
    //   'ts-jest': {
    //     tsconfig: 'tsconfig.jest.json'
    //   }
    // }
  }
};
