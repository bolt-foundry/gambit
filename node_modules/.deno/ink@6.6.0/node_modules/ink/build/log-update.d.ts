import { type Writable } from 'node:stream';
export type LogUpdate = {
    clear: () => void;
    done: () => void;
    sync: (str: string) => void;
    (str: string): void;
};
declare const logUpdate: {
    create: (stream: Writable, { showCursor, incremental }?: {
        showCursor?: boolean | undefined;
        incremental?: boolean | undefined;
    }) => LogUpdate;
};
export default logUpdate;
