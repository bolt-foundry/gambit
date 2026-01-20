import {
  BaseServiceParams,
  RealtimeTokenParams,
  CreateRealtimeTranscriberParams,
  RealtimeTranscriberParams,
  RealtimeTemporaryTokenResponse,
  CreateRealtimeServiceParams,
} from "../..";
import { RealtimeService, RealtimeTranscriber } from "./service";
import { BaseService } from "../base";

export class RealtimeTranscriberFactory extends BaseService {
  private rtFactoryParams: BaseServiceParams;
  constructor(params: BaseServiceParams) {
    super(params);
    this.rtFactoryParams = params;
  }

  /**
   * @deprecated Use transcriber(...) instead
   */
  createService(params?: CreateRealtimeServiceParams): RealtimeService {
    return this.transcriber(params);
  }

  transcriber(params?: CreateRealtimeTranscriberParams): RealtimeTranscriber {
    const serviceParams = { ...params } as Record<string, unknown>;
    if (!serviceParams.token && !serviceParams.apiKey) {
      serviceParams.apiKey = this.rtFactoryParams.apiKey;
    }

    return new RealtimeTranscriber(serviceParams as RealtimeTranscriberParams);
  }

  async createTemporaryToken(params: RealtimeTokenParams) {
    const data = await this.fetchJson<RealtimeTemporaryTokenResponse>(
      "/v2/realtime/token",
      {
        method: "POST",
        body: JSON.stringify(params),
      },
    );
    return data.token;
  }
}

/**
 * @deprecated Use RealtimeTranscriberFactory instead
 */
export class RealtimeServiceFactory extends RealtimeTranscriberFactory {}
