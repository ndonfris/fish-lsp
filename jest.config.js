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
    moduleNameMapper: {
    	"^completion/(.*)$": "<rootDir>/src/utils/completion/$1",
    	"^utils/(.*)$": "<rootDir>/src/utils/$1",
    	"^test-data/(.*)$": "<rootDir>/test-data/$1"
    },
    transformIgnorePatterns: [
        "<rootDir>/node_modules/",
    ],
    transform: {
        "^.+\\.ts?$": "ts-jest",
        "^.+\\.js?$": "babel-jest",
    },
    testRegex: "\\.test\\.ts$",
    preset: "ts-jest",
    testTimeout: 8000,
    //minWorkers: 5,
    maxWorkers: "50%/4"
    //maxWorkers: "20%",
};