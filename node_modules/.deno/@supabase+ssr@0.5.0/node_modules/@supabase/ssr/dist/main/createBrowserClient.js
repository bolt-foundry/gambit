"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBrowserClient = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const version_1 = require("./version");
const utils_1 = require("./utils");
const cookies_1 = require("./cookies");
let cachedBrowserClient;
function createBrowserClient(supabaseUrl, supabaseKey, options) {
    // singleton client is created only if isSingleton is set to true, or if isSingleton is not defined and we detect a browser
    const shouldUseSingleton = options?.isSingleton === true ||
        ((!options || !("isSingleton" in options)) && (0, utils_1.isBrowser)());
    if (shouldUseSingleton && cachedBrowserClient) {
        return cachedBrowserClient;
    }
    if (!supabaseUrl || !supabaseKey) {
        throw new Error(`@supabase/ssr: Your project's URL and API key are required to create a Supabase client!\n\nCheck your Supabase project's API settings to find these values\n\nhttps://supabase.com/dashboard/project/_/settings/api`);
    }
    const { storage } = (0, cookies_1.createStorageFromOptions)({
        ...options,
        cookieEncoding: options?.cookieEncoding ?? "base64url",
    }, false);
    const client = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey, {
        ...options,
        global: {
            ...options?.global,
            headers: {
                ...options?.global?.headers,
                "X-Client-Info": `supabase-ssr/${version_1.VERSION}`,
            },
        },
        auth: {
            ...options?.auth,
            ...(options?.cookieOptions?.name
                ? { storageKey: options.cookieOptions.name }
                : null),
            flowType: "pkce",
            autoRefreshToken: (0, utils_1.isBrowser)(),
            detectSessionInUrl: (0, utils_1.isBrowser)(),
            persistSession: true,
            storage,
        },
    });
    if (shouldUseSingleton) {
        cachedBrowserClient = client;
    }
    return client;
}
exports.createBrowserClient = createBrowserClient;
//# sourceMappingURL=createBrowserClient.js.map