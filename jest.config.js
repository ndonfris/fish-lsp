'use-strict';
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // transform: { '^.+\.ts?$': ['ts-jest', { isolatedModules: true }] }
  // globals: {
  //   'ts-jest': {
  //     isolatedModules: true
  //   }
  // },
};

// module.exports = {
//   preset: 'ts-jest',
//   testEnvironment: 'node',
//   moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
//   testMatch: [
//     '**/src/**/*.test.ts',     // Match test files in the src directory
//     '**/test-data/**/*.test.ts' // Match test files in the test-data directory
//   ],
//   transform: {
//     '^.+\\.(ts|tsx)$': 'ts-jest',
//   },
//   globals: {
//     'ts-jest': {
//       tsconfig: 'tsconfig.jest.json',
//     },
//   },
//   moduleNameMapper: {
//     '^@src/(.*)$': '<rootDir>/src/$1',
//     '^@test-data/(.*)$': '<rootDir>/test-data/$1',
//   },
// };
