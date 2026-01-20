/**
 * Create an esbuild plugin to compile MDX to JS.
 *
 * esbuild takes care of turning modern JavaScript features into syntax that
 * works wherever you want it to.
 * With other integrations you might need to use Babel for this, but with
 * esbuild that’s not needed.
 * See esbuild’s docs for more info.
 *
 * @param {Readonly<Options> | null | undefined} [options]
 *   Configuration (optional).
 * @return {Plugin}
 *   Plugin.
 */
export function esbuild(options?: Readonly<Options> | null | undefined): Plugin;
/**
 * Data passed to `onload`.
 */
export type LoadData = Omit<OnLoadArgs, "pluginData"> & LoadDataFields;
/**
 * Extra fields given in `data` to `onload`.
 */
export type LoadDataFields = {
    /**
     * Plugin data.
     */
    pluginData?: PluginData | null | undefined;
};
/**
 * Configuration.
 *
 * Options are the same as `compile` from `@mdx-js/mdx`.
 */
export type Options = CompileOptions;
/**
 * Extra data passed.
 */
export type PluginData = {
    /**
     * File contents.
     */
    contents?: Buffer | string | null | undefined;
};
/**
 * Info passed around.
 */
export type State = {
    /**
     *   File value.
     */
    doc: string;
    /**
     *   Plugin name.
     */
    name: string;
    /**
     *   File path.
     */
    path: string;
};
import type { Plugin } from 'esbuild';
import type { OnLoadArgs } from 'esbuild';
import type { CompileOptions } from '@mdx-js/mdx';
import { Buffer } from 'node:buffer';
//# sourceMappingURL=index.d.ts.map