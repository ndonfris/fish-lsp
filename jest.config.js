module.exports = {
  clearMocks: true,
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.jest.json',
    },
  },
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  modulePathIgnorePatterns: ['<rootDir>/lib'],
  transform: {
    '\\.ts$': 'ts-jest',
  },
  testRegex: '\\.test\\.ts$',
  preset: 'ts-jest',
  testTimeout: 2000,
  maxWorkers: '50%',
}
