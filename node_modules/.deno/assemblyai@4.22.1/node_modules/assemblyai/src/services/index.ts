import { BaseServiceParams } from "..";
import { LemurService } from "./lemur";
import {
  RealtimeTranscriber,
  RealtimeTranscriberFactory,
  RealtimeService,
  RealtimeServiceFactory,
} from "./realtime";
import { TranscriptService } from "./transcripts";
import { FileService } from "./files";
import { StreamingTranscriber, StreamingTranscriberFactory } from "./streaming";

const defaultBaseUrl = "https://api.assemblyai.com";
const defaultStreamingUrl = "https://streaming.assemblyai.com";

class AssemblyAI {
  /**
   * The files service.
   */
  public files: FileService;

  /**
   * The transcripts service.
   */
  public transcripts: TranscriptService;

  /**
   * The LeMUR service.
   */
  public lemur: LemurService;

  /**
   * The realtime service.
   */
  public realtime: RealtimeTranscriberFactory;

  /**
   * The streaming service.
   */
  public streaming: StreamingTranscriberFactory;

  /**
   * Create a new AssemblyAI client.
   * @param params - The parameters for the service, including the API key and base URL, if any.
   */
  constructor(params: BaseServiceParams) {
    params.baseUrl = params.baseUrl || defaultBaseUrl;
    if (params.baseUrl && params.baseUrl.endsWith("/")) {
      params.baseUrl = params.baseUrl.slice(0, -1);
    }

    this.files = new FileService(params);
    this.transcripts = new TranscriptService(params, this.files);
    this.lemur = new LemurService(params);
    this.realtime = new RealtimeTranscriberFactory(params);

    this.streaming = new StreamingTranscriberFactory({
      ...params,
      baseUrl: params.streamingBaseUrl || defaultStreamingUrl,
    });
  }
}

export {
  AssemblyAI,
  LemurService,
  RealtimeTranscriberFactory,
  RealtimeTranscriber,
  RealtimeServiceFactory,
  RealtimeService,
  TranscriptService,
  FileService,
  StreamingTranscriber,
};
