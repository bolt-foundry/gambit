import { type ReactNode } from 'react';
/**
Performance metrics for a render operation.
*/
export type RenderMetrics = {
    /**
    Time spent rendering in milliseconds.
    */
    renderTime: number;
};
export type Options = {
    stdout: NodeJS.WriteStream;
    stdin: NodeJS.ReadStream;
    stderr: NodeJS.WriteStream;
    debug: boolean;
    exitOnCtrlC: boolean;
    patchConsole: boolean;
    onRender?: (metrics: RenderMetrics) => void;
    isScreenReaderEnabled?: boolean;
    waitUntilExit?: () => Promise<void>;
    maxFps?: number;
    incrementalRendering?: boolean;
};
export default class Ink {
    private readonly options;
    private readonly log;
    private readonly throttledLog;
    private readonly isScreenReaderEnabled;
    private isUnmounted;
    private lastOutput;
    private lastOutputHeight;
    private lastTerminalWidth;
    private readonly container;
    private readonly rootNode;
    private fullStaticOutput;
    private exitPromise?;
    private restoreConsole?;
    private readonly unsubscribeResize?;
    constructor(options: Options);
    getTerminalWidth: () => number;
    resized: () => void;
    resolveExitPromise: () => void;
    rejectExitPromise: (reason?: Error) => void;
    unsubscribeExit: () => void;
    calculateLayout: () => void;
    onRender: () => void;
    render(node: ReactNode): void;
    writeToStdout(data: string): void;
    writeToStderr(data: string): void;
    unmount(error?: Error | number | null): void;
    waitUntilExit(): Promise<void>;
    clear(): void;
    patchConsole(): void;
}
