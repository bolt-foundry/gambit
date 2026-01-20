"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const base64url_1 = require("./base64url");
const EXAMPLES = [
    "a",
    "ab",
    "abc",
    "abcd",
    "hello world",
    "нешто на кирилица",
    "something with emojis 🤙🏾 ",
    "Supabaseは、オープンソースの Firebase 代替製品です。エンタープライズグレードのオープンソースツールを使って、Firebase の機能を構築しています。",
];
(0, vitest_1.describe)("stringToBase64URL", () => {
    EXAMPLES.forEach((example) => {
        (0, vitest_1.test)(`encode "${example}"`, () => {
            (0, vitest_1.expect)((0, base64url_1.stringToBase64URL)(example)).toEqual(Buffer.from(example).toString("base64url"));
        });
    });
});
(0, vitest_1.describe)("stringFromBase64URL", () => {
    EXAMPLES.forEach((example) => {
        (0, vitest_1.test)(`decode "${example}"`, () => {
            (0, vitest_1.expect)((0, base64url_1.stringFromBase64URL)("\r\t\n " + Buffer.from(example).toString("base64url"))).toEqual(example);
        });
    });
    (0, vitest_1.test)("decode with invalid Base64-URL character", () => {
        (0, vitest_1.expect)(() => {
            (0, base64url_1.stringFromBase64URL)("*");
        }).toThrow(new Error(`Invalid Base64-URL character "*" at position 0`));
    });
});
const BAD_UTF8 = [
    [0xf8], // 11111000
    [0xff], // 11111111
    [0x80], // 10000000
    [0xf8, 1], // 11110000 00000001
    [0xe0, 1], // 11100000 00000001
    [0xc0, 1], // 11100000 00000001
];
(0, vitest_1.describe)("stringFromUTF8", () => {
    BAD_UTF8.forEach((example) => {
        (0, vitest_1.test)(`should recognize bad UTF-8 sequence ${example.map((x) => x.toString(16)).join(" ")}`, () => {
            (0, vitest_1.expect)(() => {
                const state = { utf8seq: 0, codepoint: 0 };
                example.forEach((byte) => {
                    (0, base64url_1.stringFromUTF8)(byte, state, () => { });
                });
            }).toThrow(new Error("Invalid UTF-8 sequence"));
        });
    });
});
(0, vitest_1.describe)("codepointToUTF8", () => {
    (0, vitest_1.test)("invalid codepoints above 0x10ffff", () => {
        const invalidCodepoint = 0x10ffff + 1;
        (0, vitest_1.expect)(() => {
            (0, base64url_1.codepointToUTF8)(invalidCodepoint, () => {
                throw new Error("Should not becalled");
            });
        }).toThrow(new Error(`Unrecognized Unicode codepoint: ${invalidCodepoint.toString(16)}`));
    });
});
//# sourceMappingURL=base64url.test.js.map