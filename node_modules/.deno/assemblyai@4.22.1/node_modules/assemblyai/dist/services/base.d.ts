import { BaseServiceParams } from "..";
/**
 * Base class for services that communicate with the API.
 */
export declare abstract class BaseService {
    private params;
    private userAgent;
    /**
     * Create a new service.
     * @param params - The parameters to use for the service.
     */
    constructor(params: BaseServiceParams);
    protected fetch(input: string, init?: RequestInit | undefined): Promise<Response>;
    protected fetchJson<T>(input: string, init?: RequestInit | undefined): Promise<T>;
}
