import { UserAgent } from "..";

type BaseServiceParams = {
  apiKey: string;
  baseUrl?: string;
  streamingBaseUrl?: string;
  /**
   * The AssemblyAI user agent to use for requests.
   * The provided components will be merged into the default AssemblyAI user agent.
   * If `false`, the AssemblyAI user agent will be removed.
   */
  userAgent?: UserAgent | false;
};

export type { BaseServiceParams };
