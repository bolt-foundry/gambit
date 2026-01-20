export type CommonOptions = {
    /**
     * Output stream where app will be rendered.
     *
     * @default process.stdout
     */
    stdout?: NodeJS.WriteStream;
    /**
     * Input stream where app will listen for input.
     *
     * @default process.stdin
     */
    stdin?: NodeJS.ReadStream;
    /**
     * Error stream.
     * @default process.stderr
     */
    stderr?: NodeJS.WriteStream;
    /**
     * If true, each update will be rendered as a separate output, without replacing the previous one.
     *
     * @default false
     */
    debug?: boolean;
    /**
     * Configure whether Ink should listen to Ctrl+C keyboard input and exit the app. This is needed in case `process.stdin` is in raw mode, because then Ctrl+C is ignored by default and process is expected to handle it manually.
     *
     * @default true
     */
    exitOnCtrlC?: boolean;
    /**
     * Patch console methods to ensure console output doesn't mix with Ink output.
     *
     * @default true
     */
    patchConsole?: boolean;
    /**
     * Enable screen reader support.
     * See https://github.com/vadimdemedes/ink/blob/master/readme.md#screen-reader-support
     *
     * @default process.env['INK_SCREEN_READER'] === 'true'
     */
    isScreenReaderEnabled?: boolean;
    /**
     * Maximum frames per second for render updates.
     * This controls how frequently the UI can update to prevent excessive re-rendering.
     * Higher values allow more frequent updates but may impact performance.
     *
     * @default 30
     */
    maxFps?: number;
};
