"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasBashShebang = exports.isFishShebang = exports.getShebang = void 0;
const SHEBANG_REGEXP = /^#!(.*)/;
function getShebang(fileContent) {
    const match = SHEBANG_REGEXP.exec(fileContent);
    if (!match || !match[1]) {
        return null;
    }
    return match[1].replace("-", "").trim();
}
exports.getShebang = getShebang;
function isFishShebang(shebang) {
    return shebang.endsWith("fish");
}
exports.isFishShebang = isFishShebang;
function hasBashShebang(fileContent) {
    const shebang = getShebang(fileContent);
    return shebang ? isFishShebang(shebang) : false;
}
exports.hasBashShebang = hasBashShebang;
//# sourceMappingURL=shebang.js.map