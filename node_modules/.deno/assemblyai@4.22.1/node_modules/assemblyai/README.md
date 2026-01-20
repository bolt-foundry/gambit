<img src="https://github.com/AssemblyAI/assemblyai-node-sdk/blob/main/assemblyai.png?raw=true" width="500"/>

---

[![npm](https://img.shields.io/npm/v/assemblyai)](https://www.npmjs.com/package/assemblyai)
[![Test](https://github.com/AssemblyAI/assemblyai-node-sdk/actions/workflows/test.yml/badge.svg)](https://github.com/AssemblyAI/assemblyai-node-sdk/actions/workflows/test.yml)
[![GitHub License](https://img.shields.io/github/license/AssemblyAI/assemblyai-node-sdk)](https://github.com/AssemblyAI/assemblyai-node-sdk/blob/main/LICENSE)
[![AssemblyAI Twitter](https://img.shields.io/twitter/follow/AssemblyAI?label=%40AssemblyAI&style=social)](https://twitter.com/AssemblyAI)
[![AssemblyAI YouTube](https://img.shields.io/youtube/channel/subscribers/UCtatfZMf-8EkIwASXM4ts0A)](https://www.youtube.com/@AssemblyAI)
[![Discord](https://img.shields.io/discord/875120158014853141?logo=discord&label=Discord&link=https%3A%2F%2Fdiscord.com%2Fchannels%2F875120158014853141&style=social)
](https://assembly.ai/discord)

# AssemblyAI JavaScript SDK

The AssemblyAI JavaScript SDK provides an easy-to-use interface for interacting with the AssemblyAI API,
which supports async and streaming transcription, as well as the latest LeMUR models.
It is written primarily for Node.js in TypeScript with all types exported, but also [compatible with other runtimes](./docs/compat.md).

## Documentation

Visit the [AssemblyAI documentation](https://www.assemblyai.com/docs) for step-by-step instructions and a lot more details about our AI models and API.
Explore the [SDK API reference](https://assemblyai.github.io/assemblyai-node-sdk/) for more details on the SDK types, functions, and classes.

## Quickstart

Install the AssemblyAI SDK using your preferred package manager:

```bash
npm install assemblyai
```

```bash
yarn add assemblyai
```

```bash
pnpm add assemblyai
```

```bash
bun add assemblyai
```

Then, import the `assemblyai` module and create an AssemblyAI object with your API key:

```js
import { AssemblyAI } from "assemblyai";

const client = new AssemblyAI({
  apiKey: process.env.ASSEMBLYAI_API_KEY,
});
```

You can now use the `client` object to interact with the AssemblyAI API.

### Using a CDN

You can use automatic CDNs like [UNPKG](https://unpkg.com/) to load the library from a script tag.

- Replace `:version` with the desired version or `latest`.
- Remove `.min` to load the non-minified version.
- Remove `.streaming` to load the entire SDK. Keep `.streaming` to load the Streaming STT specific version.

```html
<!-- Unminified full SDK -->
<script src="https://www.unpkg.com/assemblyai@:version/dist/assemblyai.umd.js"></script>
<!-- Minified full SDK -->
<script src="https://www.unpkg.com/assemblyai@:version/dist/assemblyai.umd.min.js"></script>
<!-- Unminified Streaming STT only -->
<script src="https://www.unpkg.com/assemblyai@:version/dist/assemblyai.streaming.umd.js"></script>
<!-- Minified Streaming STT only -->
<script src="https://www.unpkg.com/assemblyai@:version/dist/assemblyai.streaming.umd.min.js"></script>
```

The script creates a global `assemblyai` variable containing all the services.
Here's how you create a `StreamingTranscriber` object.

```js
const { StreamingTranscriber } = assemblyai;
const transcriber = new StreamingTranscriber({
  token: "[GENERATE TEMPORARY AUTH TOKEN IN YOUR API]",
  ...
});
```

For type support in your IDE, see [Reference types from JavaScript](./docs/reference-types-from-js.md).

## Speech-To-Text

### Transcribe audio and video files

<details open>
  <summary>Transcribe an audio file with a public URL</summary>

When you create a transcript, you can either pass in a URL to an audio file or upload a file directly.

```js
// Transcribe file at remote URL
let transcript = await client.transcripts.transcribe({
  audio: "https://assembly.ai/espn.m4a",
});
```

> [!NOTE]
> You can also pass a local file path, a stream, or a buffer as the `audio` property.

`transcribe` queues a transcription job and polls it until the `status` is `completed` or `error`.

If you don't want to wait until the transcript is ready, you can use `submit`:

```js
let transcript = await client.transcripts.submit({
  audio: "https://assembly.ai/espn.m4a",
});
```

</details>

<details>
  <summary>Transcribe a local audio file</summary>

When you create a transcript, you can either pass in a URL to an audio file or upload a file directly.

```js
// Upload a file via local path and transcribe
let transcript = await client.transcripts.transcribe({
  audio: "./news.mp4",
});
```

> **Note:**
> You can also pass a file URL, a stream, or a buffer as the `audio` property.

`transcribe` queues a transcription job and polls it until the `status` is `completed` or `error`.

If you don't want to wait until the transcript is ready, you can use `submit`:

```js
let transcript = await client.transcripts.submit({
  audio: "./news.mp4",
});
```

</details>

<details>
  <summary>Enable additional AI models</summary>

You can extract even more insights from the audio by enabling any of our [AI models](https://www.assemblyai.com/docs/audio-intelligence) using _transcription options_.
For example, here's how to enable [Speaker diarization](https://www.assemblyai.com/docs/speech-to-text/speaker-diarization) model to detect who said what.

```js
let transcript = await client.transcripts.transcribe({
  audio: "https://assembly.ai/espn.m4a",
  speaker_labels: true,
});
for (let utterance of transcript.utterances) {
  console.log(`Speaker ${utterance.speaker}: ${utterance.text}`);
}
```

</details>

<details>
  <summary>Get a transcript</summary>

This will return the transcript object in its current state. If the transcript is still processing, the `status` field will be `queued` or `processing`. Once the transcript is complete, the `status` field will be `completed`.

```js
const transcript = await client.transcripts.get(transcript.id);
```

If you created a transcript using `.submit()`, you can still poll until the transcript `status` is `completed` or `error` using `.waitUntilReady()`:

```js
const transcript = await client.transcripts.waitUntilReady(transcript.id, {
  // How frequently the transcript is polled in ms. Defaults to 3000.
  pollingInterval: 1000,
  // How long to wait in ms until the "Polling timeout" error is thrown. Defaults to infinite (-1).
  pollingTimeout: 5000,
});
```

</details>
<details>
  <summary>Get sentences and paragraphs</summary>

```js
const sentences = await client.transcripts.sentences(transcript.id);
const paragraphs = await client.transcripts.paragraphs(transcript.id);
```

</details>

<details>
  <summary>Get subtitles</summary>

```js
const charsPerCaption = 32;
let srt = await client.transcripts.subtitles(transcript.id, "srt");
srt = await client.transcripts.subtitles(transcript.id, "srt", charsPerCaption);

let vtt = await client.transcripts.subtitles(transcript.id, "vtt");
vtt = await client.transcripts.subtitles(transcript.id, "vtt", charsPerCaption);
```

</details>
<details>
  <summary>List transcripts</summary>

This will return a page of transcripts you created.

```js
const page = await client.transcripts.list();
```

You can also paginate over all pages.

```typescript
let previousPageUrl: string | null = null;
do {
  const page = await client.transcripts.list(previousPageUrl);
  previousPageUrl = page.page_details.prev_url;
} while (previousPageUrl !== null);
```

> [!NOTE]
> To paginate over all pages, you need to use the `page.page_details.prev_url`
> because the transcripts are returned in descending order by creation date and time.
> The first page is are the most recent transcript, and each "previous" page are older transcripts.

</details>

<details>
<summary>Delete a transcript</summary>

```js
const res = await client.transcripts.delete(transcript.id);
```

</details>

### Transcribe in real-time

Create the streaming transcriber.

```typescript
const rt = client.streaming.transcriber();
```

You can also pass in the following options.

```typescript
const rt = client.streaming.transcriber({
  apiKey: process.env.ASSEMBLYAI_API_KEY // The API key passed to `AssemblyAI` will be used by default,
  sampleRate: 16_000,
});
```

> [!WARNING]
> Storing your API key in client-facing applications exposes your API key.
> Generate a temporary auth token on the server and pass it to your client.
> _Server code_:
>
> ```typescript
> const token = await client.streaming.createTemporaryToken({
>   expires_in_seconds = 60,
> });
> // TODO: return token to client
> ```
>
> _Client code_:
>
> ```typescript
> import { StreamingTranscriber } from "assemblyai";
> // TODO: implement getToken to retrieve token from server
> const token = await getToken();
> const rt = new StreamingTranscriber({
>   token,
> });
> ```

You can configure the following events.

<!-- prettier-ignore -->
```typescript
rt.on("open", ({ id, expires_at }) => console.log('Session ID:', id, 'Expires at:', expires_at));
rt.on("close", (code: number, reason: string) => console.log('Closed', code, reason));
rt.on("turn", ({ transcript }) => console.log('Transcript:', transcript));
rt.on("error", (error: Error) => console.error('Error', error));
```

After configuring your events, connect to the server.

```typescript
await rt.connect();
```

Send audio data via chunks.

```typescript
// Pseudo code for getting audio
getAudio((chunk) => {
  rt.sendAudio(chunk);
});
```

Or send audio data via a stream:

```typescript
audioStream.pipeTo(rt.stream());
```

Close the connection when you're finished.

```typescript
await rt.close();
```

## Apply LLMs to your audio with LeMUR

Call [LeMUR endpoints](https://www.assemblyai.com/docs/api-reference/lemur) to apply LLMs to your transcript.

<details open>
<summary>Prompt your audio with LeMUR</summary>

```js
const { response } = await client.lemur.task({
  transcript_ids: ["0d295578-8c75-421a-885a-2c487f188927"],
  prompt: "Write a haiku about this conversation.",
});
```

</details>

<details>
<summary>Summarize with LeMUR</summary>

```js
const { response } = await client.lemur.summary({
  transcript_ids: ["0d295578-8c75-421a-885a-2c487f188927"],
  answer_format: "one sentence",
  context: {
    speakers: ["Alex", "Bob"],
  },
});
```

</details>

<details>
<summary>Ask questions</summary>

```js
const { response } = await client.lemur.questionAnswer({
  transcript_ids: ["0d295578-8c75-421a-885a-2c487f188927"],
  questions: [
    {
      question: "What are they discussing?",
      answer_format: "text",
    },
  ],
});
```

</details>
<details>
<summary>Generate action items</summary>

```js
const { response } = await client.lemur.actionItems({
  transcript_ids: ["0d295578-8c75-421a-885a-2c487f188927"],
});
```

</details>
<details>
<summary>Delete LeMUR request</summary>

```js
const response = await client.lemur.purgeRequestData(lemurResponse.request_id);
```

</details>

## Contributing

If you want to contribute to the JavaScript SDK, follow the guidelines in [CONTRIBUTING.md](./CONTRIBUTING.md).
