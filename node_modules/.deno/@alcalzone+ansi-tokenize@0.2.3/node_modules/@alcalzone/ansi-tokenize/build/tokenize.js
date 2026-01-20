import isFullwidthCodePoint from "is-fullwidth-code-point";
import { CSI, ESCAPES, getEndCode, linkStartCodePrefix, linkStartCodePrefixCharCodes, OSC, } from "./ansiCodes.js";
// HOT PATH: Use only basic string/char code operations for maximum performance
function parseLinkCode(string, offset) {
    string = string.slice(offset);
    for (let index = 1; index < linkStartCodePrefixCharCodes.length; index++) {
        if (string.charCodeAt(index) !== linkStartCodePrefixCharCodes[index]) {
            return undefined;
        }
    }
    // This is a link code (with or without the URL part). Find the end of it.
    const endIndex = string.indexOf("\x07", linkStartCodePrefix.length);
    if (endIndex === -1)
        return undefined;
    return string.slice(0, endIndex + 1);
}
const CC_0 = "0".charCodeAt(0);
const CC_9 = "9".charCodeAt(0);
const CC_SEMI = ";".charCodeAt(0);
const CC_M = "m".charCodeAt(0);
/**
 * Scans through the given string and finds the index of the last character of an SGR sequence
 * like `\x1B[38;2;123;123;123m`. This assumes that the string has been checked to start with `\x1B[`.
 * Returns -1 if no valid SGR sequence is found.
 */
function findSGRSequenceEndIndex(str) {
    for (let index = 2; index < str.length; index++) {
        const charCode = str.charCodeAt(index);
        // m marks the end of the SGR sequence
        if (charCode === CC_M)
            return index;
        // Digits and semicolons are valid
        if (charCode === CC_SEMI)
            continue;
        if (charCode >= CC_0 && charCode <= CC_9)
            continue;
        // Everything else is invalid
        break;
    }
    return -1;
}
// HOT PATH: Use only basic string/char code operations for maximum performance
function parseSGRSequence(string, offset) {
    string = string.slice(offset);
    const endIndex = findSGRSequenceEndIndex(string);
    if (endIndex === -1)
        return;
    return string.slice(0, endIndex + 1);
}
/**
 * Splits compound SGR sequences like `\x1B[1;3;31m` into individual components
 */
function splitCompoundSGRSequences(code) {
    if (!code.includes(";")) {
        // Not a compound code
        return [code];
    }
    const codeParts = code
        // Strip off the escape sequences \x1B[ and m
        .slice(2, -1)
        .split(";");
    const ret = [];
    for (let i = 0; i < codeParts.length; i++) {
        const rawCode = codeParts[i];
        // Keep 8-bit and 24-bit color codes (containing multiple ";") together
        if (rawCode === "38" || rawCode === "48") {
            if (i + 2 < codeParts.length && codeParts[i + 1] === "5") {
                // 8-bit color, followed by another number
                ret.push(codeParts.slice(i, i + 3).join(";"));
                i += 2;
                continue;
            }
            else if (i + 4 < codeParts.length && codeParts[i + 1] === "2") {
                // 24-bit color, followed by three numbers
                ret.push(codeParts.slice(i, i + 5).join(";"));
                i += 4;
                continue;
            }
        }
        // Not a (valid) 8/24-bit color code, push as is
        ret.push(rawCode);
    }
    return ret.map((part) => `\x1b[${part}m`);
}
export function tokenize(str, endChar = Number.POSITIVE_INFINITY) {
    const ret = [];
    let index = 0;
    let visible = 0;
    while (index < str.length) {
        const codePoint = str.codePointAt(index);
        if (ESCAPES.has(codePoint)) {
            let code;
            // Peek the next code point to determine the type of ANSI sequence
            const nextCodePoint = str.codePointAt(index + 1);
            if (nextCodePoint === OSC) {
                // ] = operating system commands, like links
                code = parseLinkCode(str, index);
                if (code) {
                    ret.push({
                        type: "ansi",
                        code: code,
                        endCode: getEndCode(code),
                    });
                }
            }
            else if (nextCodePoint === CSI) {
                // [ = control sequence introducer, like SGR sequences [...m
                code = parseSGRSequence(str, index);
                if (code) {
                    // Split compound codes into individual tokens
                    const codes = splitCompoundSGRSequences(code);
                    for (const individualCode of codes) {
                        ret.push({
                            type: "ansi",
                            code: individualCode,
                            endCode: getEndCode(individualCode),
                        });
                    }
                }
            }
            if (code) {
                index += code.length;
                continue;
            }
        }
        const fullWidth = isFullwidthCodePoint(codePoint);
        const character = String.fromCodePoint(codePoint);
        ret.push({
            type: "char",
            value: character,
            fullWidth,
        });
        index += character.length;
        visible += fullWidth ? 2 : character.length;
        if (visible >= endChar) {
            break;
        }
    }
    return ret;
}
//# sourceMappingURL=tokenize.js.map