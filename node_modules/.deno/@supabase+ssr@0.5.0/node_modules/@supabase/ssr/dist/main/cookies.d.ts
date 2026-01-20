import type { CookieMethodsServer, CookieMethodsServerDeprecated, CookieMethodsBrowser, CookieMethodsBrowserDeprecated, CookieOptions, CookieOptionsWithName, GetAllCookies, SetAllCookies } from "./types";
/**
 * Creates a storage client that handles cookies correctly for browser and
 * server clients with or without properly provided cookie methods.
 *
 * @param options The options passed to createBrowserClient or createServer client.
 *
 * @param isServerClient Whether it's called from createServerClient.
 */
export declare function createStorageFromOptions(options: {
    cookieEncoding: "raw" | "base64url";
    cookies?: CookieMethodsBrowser | CookieMethodsBrowserDeprecated | CookieMethodsServer | CookieMethodsServerDeprecated;
    cookieOptions?: CookieOptionsWithName;
}, isServerClient: boolean): {
    getAll: (keyHints: string[]) => ReturnType<GetAllCookies>;
    setAll: SetAllCookies;
    setItems: {
        [key: string]: string;
    };
    removedItems: {
        [key: string]: boolean;
    };
    storage: {
        isServer: boolean;
        getItem: (key: string) => Promise<string | null>;
        setItem: (key: string, value: string) => Promise<void>;
        removeItem: (key: string) => Promise<void>;
    };
};
/**
 * When createServerClient needs to apply the created storage to cookies, it
 * should call this function which handles correcly setting cookies for stored
 * and removed items in the storage.
 */
export declare function applyServerStorage({ getAll, setAll, setItems, removedItems, }: {
    getAll: (keyHints: string[]) => ReturnType<GetAllCookies>;
    setAll: SetAllCookies;
    setItems: {
        [name: string]: string;
    };
    removedItems: {
        [name: string]: boolean;
    };
}, options: {
    cookieEncoding: "raw" | "base64url";
    cookieOptions?: CookieOptions | null;
}): Promise<void>;
