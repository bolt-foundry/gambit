import { conditions } from "#conditions";
import { DEFAULT_FETCH_INIT } from "#fetch";
import { BaseServiceParams, Error as JsonError } from "..";
import { buildUserAgent } from "../utils/userAgent";

/**
 * Base class for services that communicate with the API.
 */
export abstract class BaseService {
  private userAgent: string | undefined;
  /**
   * Create a new service.
   * @param params - The parameters to use for the service.
   */
  constructor(private params: BaseServiceParams) {
    if (params.userAgent === false) {
      this.userAgent = undefined;
    } else {
      this.userAgent = buildUserAgent(params.userAgent || {});
    }
  }
  protected async fetch(
    input: string,
    init?: RequestInit | undefined,
  ): Promise<Response> {
    init = { ...DEFAULT_FETCH_INIT, ...init };
    let headers = {
      Authorization: this.params.apiKey,
      "Content-Type": "application/json",
    };
    if (DEFAULT_FETCH_INIT?.headers)
      headers = { ...headers, ...DEFAULT_FETCH_INIT.headers };
    if (init?.headers) headers = { ...headers, ...init.headers };

    if (this.userAgent) {
      (headers as Record<string, string>)["User-Agent"] = this.userAgent;
      if (conditions.browser || conditions.default) {
        // chromium browsers have a bug where the user agent can't be modified
        if (typeof window !== "undefined" && "chrome" in window) {
          (headers as Record<string, string>)["AssemblyAI-Agent"] =
            this.userAgent;
        }
      }
    }
    init.headers = headers;

    if (!input.startsWith("http")) input = this.params.baseUrl + input;

    const response = await fetch(input, init);

    if (response.status >= 400) {
      let json: JsonError | undefined;
      const text = await response.text();
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          /* empty */
        }
        if (json?.error) throw new Error(json.error);
        throw new Error(text);
      }
      throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
    }

    return response;
  }

  protected async fetchJson<T>(
    input: string,
    init?: RequestInit | undefined,
  ): Promise<T> {
    const response = await this.fetch(input, init);
    return response.json() as Promise<T>;
  }
}
