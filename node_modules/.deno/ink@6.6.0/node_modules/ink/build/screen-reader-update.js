import ansiEscapes from 'ansi-escapes';
import wrapAnsi from 'wrap-ansi';
class ScreenReaderUpdate {
    stdout;
    stderr;
    previousOutput = '';
    previousLineCount = 0;
    constructor(stdout, stderr) {
        this.stdout = stdout;
        this.stderr = stderr;
    }
    wrap(output) {
        const width = this.stdout.columns || 80;
        return wrapAnsi(output, width, { trim: false, hard: true });
    }
    render(output) {
        const wrapped = this.wrap(output);
        if (wrapped === this.previousOutput) {
            return;
        }
        const erase = this.previousLineCount > 0 ? ansiEscapes.eraseLines(this.previousLineCount) : '';
        this.stdout.write(erase + wrapped);
        this.previousOutput = wrapped;
        this.previousLineCount = wrapped === '' ? 0 : wrapped.split('\n').length;
    }
    writeStdout(data) {
        const erase = this.previousLineCount > 0 ? ansiEscapes.eraseLines(this.previousLineCount) : '';
        this.stdout.write(erase + data + this.previousOutput);
    }
    writeStderr(data) {
        const erase = this.previousLineCount > 0 ? ansiEscapes.eraseLines(this.previousLineCount) : '';
        this.stdout.write(erase);
        this.stderr.write(data);
        this.stdout.write(this.previousOutput);
    }
}
export default ScreenReaderUpdate;
//# sourceMappingURL=screen-reader-update.js.map