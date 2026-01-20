import { type WriteStream } from 'node:tty';
declare class ScreenReaderUpdate {
    private readonly stdout;
    private readonly stderr;
    private previousOutput;
    private previousLineCount;
    constructor(stdout: WriteStream, stderr: WriteStream);
    private wrap;
    render(output: string): void;
    writeStdout(data: string): void;
    writeStderr(data: string): void;
}
export default ScreenReaderUpdate;
