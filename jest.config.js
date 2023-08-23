module.exports = {
    clearMocks: true,
    //globals: {
    //"ts-jest": {
    //tsconfig: "tsconfig.jest.json",
    //},
    //},
    verbose: true,
    moduleFileExtensions: ["ts", "js", "json", "node"],
    modulePathIgnorePatterns: ["<rootDir>/out"],
    bail: 1,
    transformIgnorePatterns: [
        "<rootDir>/node_modules/",
    ],
    transform: {
        "^.+\\.ts?$": "ts-jest",
        "^.+\\.js?$": "babel-jest",
    },
    testRegex: "\\.test\\.ts$",
    preset: "ts-jest",
    testTimeout: 2000,
    maxWorkers: "50%",
};
