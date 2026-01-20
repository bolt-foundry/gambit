"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isBrowser = exports.serializeCookieHeader = exports.parseCookieHeader = exports.serialize = exports.parse = void 0;
const cookie_1 = require("cookie");
/**
 * @deprecated Since v0.4.0: Please use {@link parseCookieHeader}. `parse` will
 * not be available for import starting v1.0.0 of `@supabase/ssr`.
 */
exports.parse = cookie_1.parse;
/**
 * @deprecated Since v0.4.0: Please use {@link serializeCookieHeader}.
 * `serialize` will not be available for import starting v1.0.0 of
 * `@supabase/ssr`.
 */
exports.serialize = cookie_1.serialize;
/**
 * Parses the `Cookie` HTTP header into an array of cookie name-value objects.
 *
 * @param header The `Cookie` HTTP header. Decodes cookie names and values from
 * URI encoding first.
 */
function parseCookieHeader(header) {
    const parsed = (0, cookie_1.parse)(header);
    return Object.keys(parsed ?? {}).map((name) => ({
        name,
        value: parsed[name],
    }));
}
exports.parseCookieHeader = parseCookieHeader;
/**
 * Converts the arguments to a valid `Set-Cookie` header. Non US-ASCII chars
 * and other forbidden cookie chars will be URI encoded.
 *
 * @param name Name of cookie.
 * @param value Value of cookie.
 */
function serializeCookieHeader(name, value, options) {
    return (0, cookie_1.serialize)(name, value, options);
}
exports.serializeCookieHeader = serializeCookieHeader;
function isBrowser() {
    return (typeof window !== "undefined" && typeof window.document !== "undefined");
}
exports.isBrowser = isBrowser;
//# sourceMappingURL=helpers.js.map