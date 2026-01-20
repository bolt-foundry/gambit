import ansiEscapes from 'ansi-escapes';
import cliCursor from 'cli-cursor';
const createStandard = (stream, { showCursor = false } = {}) => {
    let previousLineCount = 0;
    let previousOutput = '';
    let hasHiddenCursor = false;
    const render = (str) => {
        if (!showCursor && !hasHiddenCursor) {
            cliCursor.hide();
            hasHiddenCursor = true;
        }
        const output = str + '\n';
        if (output === previousOutput) {
            return;
        }
        previousOutput = output;
        stream.write(ansiEscapes.eraseLines(previousLineCount) + output);
        previousLineCount = output.split('\n').length;
    };
    render.clear = () => {
        stream.write(ansiEscapes.eraseLines(previousLineCount));
        previousOutput = '';
        previousLineCount = 0;
    };
    render.done = () => {
        previousOutput = '';
        previousLineCount = 0;
        if (!showCursor) {
            cliCursor.show();
            hasHiddenCursor = false;
        }
    };
    render.sync = (str) => {
        const output = str + '\n';
        previousOutput = output;
        previousLineCount = output.split('\n').length;
    };
    return render;
};
const createIncremental = (stream, { showCursor = false } = {}) => {
    let previousLines = [];
    let previousOutput = '';
    let hasHiddenCursor = false;
    const render = (str) => {
        if (!showCursor && !hasHiddenCursor) {
            cliCursor.hide();
            hasHiddenCursor = true;
        }
        const output = str + '\n';
        if (output === previousOutput) {
            return;
        }
        const previousCount = previousLines.length;
        const nextLines = output.split('\n');
        const nextCount = nextLines.length;
        const visibleCount = nextCount - 1;
        if (output === '\n' || previousOutput.length === 0) {
            stream.write(ansiEscapes.eraseLines(previousCount) + output);
            previousOutput = output;
            previousLines = nextLines;
            return;
        }
        // We aggregate all chunks for incremental rendering into a buffer, and then write them to stdout at the end.
        const buffer = [];
        // Clear extra lines if the current content's line count is lower than the previous.
        if (nextCount < previousCount) {
            buffer.push(
            // Erases the trailing lines and the final newline slot.
            ansiEscapes.eraseLines(previousCount - nextCount + 1), 
            // Positions cursor to the top of the rendered output.
            ansiEscapes.cursorUp(visibleCount));
        }
        else {
            buffer.push(ansiEscapes.cursorUp(previousCount - 1));
        }
        for (let i = 0; i < visibleCount; i++) {
            // We do not write lines if the contents are the same. This prevents flickering during renders.
            if (nextLines[i] === previousLines[i]) {
                buffer.push(ansiEscapes.cursorNextLine);
                continue;
            }
            buffer.push(ansiEscapes.cursorTo(0) +
                nextLines[i] +
                ansiEscapes.eraseEndLine +
                '\n');
        }
        stream.write(buffer.join(''));
        previousOutput = output;
        previousLines = nextLines;
    };
    render.clear = () => {
        stream.write(ansiEscapes.eraseLines(previousLines.length));
        previousOutput = '';
        previousLines = [];
    };
    render.done = () => {
        previousOutput = '';
        previousLines = [];
        if (!showCursor) {
            cliCursor.show();
            hasHiddenCursor = false;
        }
    };
    render.sync = (str) => {
        const output = str + '\n';
        previousOutput = output;
        previousLines = output.split('\n');
    };
    return render;
};
const create = (stream, { showCursor = false, incremental = false } = {}) => {
    if (incremental) {
        return createIncremental(stream, { showCursor });
    }
    return createStandard(stream, { showCursor });
};
const logUpdate = { create };
export default logUpdate;
//# sourceMappingURL=log-update.js.map