# SDK Compatibility

The JavaScript SDK is developed for Node.js but is also compatible with other runtimes
such as the browser, Deno, Bun, Cloudflare Workers, etc.

## Node.js compatibility

The SDK supports Node.js 18, 20, and 21.
If you do use an older version of Node.js like version 16, you'll need to polyfill `fetch`.

## Browser compatibility

To make the SDK compatible with the browser, the SDK aims to use web standards as much as possible.
However, there are still incompatibilities between Node.js and the browser.

- `StreamingTranscriber` doesn't support the AssemblyAI API key in the browser.
  Instead, you have to generate a temporary auth token using `client.streaming.createTemporaryToken`, and pass in the resulting token to the streaming transcriber.

  Generate a temporary auth token on the server.

  ```js
  import { AssemblyAI } from "assemblyai";
  // Ideally, to avoid embedding your API key client side,
  // you generate this token on the server, and pass it to the client via an API.
  const client = new AssemblyAI({ apiKey: "YOUR_API_KEY" });
  const token = await client.streaming.createTemporaryToken({
    expires_in_seconds: 60,
  });
  ```

  > [!NOTE]
  > We recommend generating the token on the server, so you don't embed your AssemblyAI API key in your client app.
  > If you embed the API key on the client, everyone can see it and use it for themselves.

  Then pass the token via an API to the client.
  On the client, create an instance of `StreamingTranscriber` using the token.

  ```js
  import { StreamingTranscriber } from "assemblyai";
  // or the following if you're using UMD
  // const { StreamingTranscriber } = assemblyai;

  const token = getToken(); // getToken is a function for you to implement

  const rt = new StreamingTranscriber({
    token: token,
  });
  ```

- You can't pass local audio file paths to `client.files.upload`, `client.transcripts.transcribe`, and `client.transcripts.submit`. If you do, you'll get the following error: "Interacting with the file system is not supported in this environment.".
  If you want to transcribe audio files, you must use a public URL, a stream, or a buffer.

> [!WARNING]
> The SDK is usable from the browser, but we strongly recommend you don't embed the AssemblyAI API key into your client apps.
> If you embed the API key on the client, everyone can see it and use it for themselves.
> Instead, create use the SDK on the server and provide APIs for your client to call.

## Deno, Bun, Cloudflare Workers, etc.

Most server-side JavaScript runtimes include a compatibility layer with Node.js.
Our SDK is developed for Node.js, which makes it compatible with other runtimes through their compatibility layer.
The bugs in these compatibility layers may introduce issues in our SDK.

## Report issues

If you find any (undocumented) bugs when using the SDK, [submit a GitHub issue](https://github.com/AssemblyAI/assemblyai-node-sdk). We'll try to fix it or at least document the compatibility issue.
