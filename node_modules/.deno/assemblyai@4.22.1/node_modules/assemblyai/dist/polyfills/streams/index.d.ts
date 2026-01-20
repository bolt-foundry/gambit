export declare const WritableStream: {
    new <W = any>(underlyingSink?: UnderlyingSink<W> | undefined, strategy?: QueuingStrategy<W> | undefined): WritableStream<W>;
    prototype: WritableStream<any>;
};
