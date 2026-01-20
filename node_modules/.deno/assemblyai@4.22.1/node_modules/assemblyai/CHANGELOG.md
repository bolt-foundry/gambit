# Changelog

## [4.20.0]

- Add `on_low_language_confidence` property to `LanguageDetectionOptions`
  > Controls behavior when language confidence is below threshold. Either "error" (default) or "fallback".
  > When set to "fallback", the transcription will use the fallback language instead of erroring when confidence is low.

## [4.8.0]

- Add `multichannel` property to `TranscriptParams`
- Add `multichannel` and `audio_channels` property to `Transcript`
- Add `channel` property to `TranscriptWord`, `TranscriptUtterance`, `TranscriptSentence`, and `SentimentAnalysisResult`

## [4.7.1]

- Log a warning when a user tries to use API key authentication in the browser to connect to the real-time Streaming STT API.
- Update dependencies
- Use assembly.ai short URL for sample files

## [4.7.0]

- Add `language_confidence_threshold` to `Transcript`, `TranscriptParams`, and `TranscriptOptionalParams`.
  > The confidence threshold for the automatically detected language.
  > An error will be returned if the langauge confidence is below this threshold.
- Add `language_confidence` to `Transcript`
  > The confidence score for the detected language, between 0.0 (low confidence) and 1.0 (high confidence)

Using these new fields you can determine the confidence of the language detection model (enable by setting `language_detection` to `true`), and fail the transcript if it doesn't meet your desired threshold.

[Learn more about the new automatic language detection model and feature improvements on our blog.](https://www.assemblyai.com/blog/ald-improvements)

## [4.6.2]

- Change `RealtimeErrorType` from enum to const object.
- Add `RealtimeErrorTypeCodes` which is a union of `RealtimeErrorType` values

## [4.6.1]

- Remove `conformer-2` from `SpeechModel` union type.
- Remove conformer-2 deprecation warning

## [4.6.0]

- Add more TSDoc comments for `RealtimeService` documentation
- Add new LeMUR models
- Add `TranscriptWebhookNotification` which is a union of `TranscriptReadyNotification` or `RedactedAudioNotification`
- Add `RedactedAudioNotification` which represents the body of the PII redacted audio webhook notification.

## [4.5.0]

- You can now retrieve previous LeMUR responses using `client.lemur.getResponse<LemurTask>("YOUR_REQUEST_ID")`.
- LeMUR functions now return `usage` with the number of `input_tokens` and `output_tokens`.

## [4.4.7]

- Rename `TranscriptService.redactions` function to `TranscriptService.redactedAudio`.
- Add `TranscriptService.redactedAudioFile` function.
- Add `workerd` export to fix `cache` issue with `fetch` on Cloudflare Workers.

## [4.4.6]

- Fix Rollup exports so \_\_SDK_VERSION\_\_ is properly replaced with the version of the SDK.

## [4.4.5]

- Add new `PiiPolicy` enum values

## [4.4.4]

- Add an export that only includes the Streaming STT code. You can use the export
  - by importing `assemblyai/streaming`,
  - or by loading the `assemblyai.streaming.umd.js` file, or `assemblyai.streaming.umd.min.js` file in a script-tag.
- Add new `EntityType` enum values

## [4.4.3] - 2024-05-09

- Add react-native exports that resolve to the browser version of the library.

## [4.4.2] - 2024-05-03

### Changed

- Caching is disabled for all HTTP request made by the SDK
- Accept data-URIs in `client.files.upload(dataUri)`, `client.transcripts.submit(audio: dataUri)`, `client.transcripts.transcribe(audio: dataUri)`.
- Change how the WebSocket libraries are imported for better compatibility across frameworks and runtimes.
  The library no longer relies on a internal `#ws` import, and instead compiles the imports into the dist bundles.
  Browser builds will use the native `WebSocket`, other builds will use the `ws` package.

## [4.4.1] - 2024-04-16

### Changed

- Deprecate `enableExtraSessionInformation` parameter in `CreateRealtimeTranscriberParams` type

## [4.4.0] - 2024-04-12

### Added

- Add `disablePartialTranscripts` parameter to `CreateRealtimeTranscriberParams`
- Add `enableExtraSessionInformation` parameter to `CreateRealtimeTranscriberParams`
- Add `session_information` event to `RealtimeTranscriber.on()`

### Changed

- ⚠️ Deprecate `conformer-2` literal for `TranscriptParams.speech_model` property

### Fixed

- Add missing `status` property to `AutoHighlightsResult`

## [4.3.4] - 2024-04-02

### Added

- `SpeechModel.Best` enum
- `TranscriptListItem.error` property

### Changed

- Make `PageDetails.prev_url` nullable
- Rename Realtime to Streaming inside code documentation
- More inline code documentation

### Fixed

- Rename `SubstitutionPolicy` literal "entity_type" to "entity_name"
- Fix the pagination example in "List transcripts" sample on README

## [4.3.3] - 2024-03-18

### Added

- GitHub action to generate API reference
- Generate API reference with Typedoc and host on GitHub Pages

### Changed

- Add `conformer-2` to `SpeechModel` type
- Change `language_code` field to accept any string
- Move from JSDoc to TSDoc
- Update `ws` to 8.13.0
- Update dev dependencies (no public facing changes)

## [4.3.2] - 2024-03-08

### Added

- Add `audio_url` property to `TranscribeParams` in addition to the `audio` property. You can use one or the other. `audio_url` only accepts a URL string.
- Add `TranscriptReadyNotification` type for the transcript webhook body.

### Changed

- Update codebase to use TSDoc
- Update README.md with more samples

## [4.3.0] - 2024-02-15

### Added

- Add `RealtimeTranscriber.configureEndUtteranceSilenceThreshold` function
- Add `RealtimeTranscriber.forceEndUtterance` function
- Add `end_utterance_silence_threshold` property to `CreateRealtimeTranscriberParams` and `RealtimeTranscriberParams` types.

## [4.2.3] - 2024-02-13

### Added

- Add `speech_model` field to `TranscriptParams` and add `SpeechModel` type.

## [4.2.2] - 2024-01-29

### Changed

- Windows paths passed to `client.transcripts.transcribe` and `client.transcripts.submit` will work as expected.

## [4.2.1] - 2024-01-23

### Added

- Add `answer_format` to `LemurActionItemsParams` type

### Changed

- Rename `RealtimeService` to `RealtimeTranscriber`, `RealtimeServiceFactory` to `RealtimeTranscriberFactory`, `RealtimeTranscriberFactory.createService()` to `RealtimeTranscriberFactory.transcriber()`. Deprecated aliases are provided for all old types and functions for backwards compatibility.
- Restrict the type for `redact_pii_audio_quality` from `string` to `RedactPiiAudioQuality` an enum string.

## [4.2.0] - 2024-01-11

### Added

- Add `content_safety_confidence` to `TranscriptParams` & `TranscriptOptionalParams`.

### Changed

- The `RealtimeService` now sends audio as binary instead of a base64-encoded JSON object.

## [4.1.0] - 2023-12-22

### Added

- Add `"anthropic/claude-2-1"` to `LemurModel` type
- Add `encoding` option to the real-time service and factory. `encoding` can be `"pcm_s16le"` or `"pcm_mulaw"`.
- `"pcm_mulaw"` is a newly supported audio encoding for the real-time service.

### Changed

- Allow any string into `final_model` for LeMUR requests

## [4.0.1] - 2023-12-14

### Added

- Add `"assemblyai/mistral-7b"` to `LemurModel` type

### Changed

- Update types with `@example`
- Update types with `Format: uuid` if applicable

## [4.0.0] - 2023-12-08

### Added

- Add `node`, `deno`, `bun`, `browser`, and `workerd` (Cloudflare Workers) exports to package.json. These exports are compatible versions of the SDK, with a few limitations in some cases. For more details, consult the [SDK Compatibility document](./docs/compat.md).
- Add `dist/assemblyai.umd.js` and `dist/assemblyai.umd.min.js`. You can reference these script files directly in the browser and the SDK will be available at the global `assemblyai` variable.

### Changed

- `RealtimeService.sendAudio` accepts audio via type `ArrayBufferLike`.
- **Breaking**: `RealtimeService.stream` returns a [WHATWG Streams Standard stream](https://nodejs.org/api/webstreams.html), instead of a Node stream. In the browser, the native web standard stream will be used.
- `ws` is used as the WebSocket client as before, but in the browser, the native WebSocket client is used.
- Rename Node SDK to JavaScript SDK as the SDK is compatible with more runtimes now.

## [3.1.1] - 2023-11-21

### Added

- Add `client.transcripts.transcribe` function to transcribe an audio file with polling until transcript status is `completed` or `error`. This function takes an `audio` option which can be an audio file URL, path, stream, or buffer.
- Add `client.transcripts.submit` function to queue a transcript. You can use `client.transcripts.waitUntilReady` to poll the transcript returned by `submit`. This function also takes an `audio` option which can be an audio file URL, path, stream, or buffer.

### Changed

- Deprecated `client.transcripts.create` in favor of `transcribe` and `submit`, to be more consistent with other AssemblyAI SDKs.
- Renamed types
  - Renamed `Parameters` type suffix with `Params` type suffix
  - Renamed `CreateTranscriptParameters` to `TranscriptParams`
  - Renamed `CreateTranscriptOptionalParameters` to `TranscriptOptionalParams`.
- Added deprecated aliases for the forementioned types
- Improved type docs

## [3.1.0] - 2023-11-16

### Added

- Add `AssemblyAI.transcripts.waitUntilReady` function to wait until a transcript is ready, meaning `status` is `completed` or `error`.
- Add `chars_per_caption` parameter to `AssemblyAI.transcripts.subtitles` function.
- Add `input_text` property to LeMUR functions. Instead of using `transcript_ids`, you can use `input_text` to provide custom formatted transcripts as input to LeMUR.

### Changed

- Change default timeout from 3 minutes to infinite (-1). Fixes [#17](https://github.com/AssemblyAI/assemblyai-node-sdk/issues/17)

### Fixed

- Correctly serialize the keywords for `client.transcripts.wordSearch`.
- Use more widely compatible syntax for wildcard exporting types. Fixes [#18](https://github.com/AssemblyAI/assemblyai-node-sdk/issues/18).

## [3.0.1] - 2023-10-30

### Changed

- The SDK uses `fetch` instead of Axios. This removes the Axios dependency. Axios relies on XMLHttpRequest which isn't supported in Cloudflare Workers, Deno, Bun, etc. By using `fetch`, the SDK is now more compatible on the forementioned runtimes.

### Fixed

- The SDK uses relative imports instead of using path aliases, to make the library transpilable with tsc for consumers. Fixes [#14](https://github.com/AssemblyAI/assemblyai-node-sdk/issues/14).
- Added `speaker` property to the `TranscriptUtterance` type, and removed `channel` property.

## [3.0.0] - 2023-10-24

### Changed

- `AssemblyAI.files.upload` accepts streams and buffers, in addition to a string (path to file).

### Removed

- **Breaking**: The module does not have a default export anymore, because of inconsistent functionality across module systems. Instead, use `AssemblyAI` as a named import like this: `import { AssemblyAI } from 'assemblyai'`.

## [2.0.2] - 2023-10-13

### Added

- `AssemblyAI.transcripts.wordSearch` searches for keywords in the transcript.
- `AssemblyAI.lemur.purgeRequestData` deletes data related to your LeMUR request.
- `RealtimeService.stream` creates a writable stream that you can write audio data to instead of using `RealtimeService.sendAudio``.

### Fixed

- The AssemblyAI class would be exported as default named export instead in certain module systems.

## [2.0.1] - 2023-10-10

Re-implement the Node SDK in TypeScript and add all AssemblyAI APIs.

### Added

- Transcript API client
- LeMUR API client
- Real-time transcript client
