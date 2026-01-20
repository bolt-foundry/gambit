import { BaseServiceParams, RealtimeTokenParams, CreateRealtimeTranscriberParams, CreateRealtimeServiceParams } from "../..";
import { RealtimeService, RealtimeTranscriber } from "./service";
import { BaseService } from "../base";
export declare class RealtimeTranscriberFactory extends BaseService {
    private rtFactoryParams;
    constructor(params: BaseServiceParams);
    /**
     * @deprecated Use transcriber(...) instead
     */
    createService(params?: CreateRealtimeServiceParams): RealtimeService;
    transcriber(params?: CreateRealtimeTranscriberParams): RealtimeTranscriber;
    createTemporaryToken(params: RealtimeTokenParams): Promise<string>;
}
/**
 * @deprecated Use RealtimeTranscriberFactory instead
 */
export declare class RealtimeServiceFactory extends RealtimeTranscriberFactory {
}
