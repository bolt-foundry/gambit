import {
  LemurSummaryParams,
  LemurActionItemsParams,
  LemurQuestionAnswerParams,
  LemurTaskParams,
  LemurSummaryResponse,
  LemurQuestionAnswerResponse,
  LemurActionItemsResponse,
  LemurTaskResponse,
  PurgeLemurRequestDataResponse,
  LemurResponse,
} from "../..";
import { BaseService } from "../base";

export class LemurService extends BaseService {
  summary(
    params: LemurSummaryParams,
    signal?: AbortSignal,
  ): Promise<LemurSummaryResponse> {
    return this.fetchJson<LemurSummaryResponse>("/lemur/v3/generate/summary", {
      method: "POST",
      body: JSON.stringify(params),
      signal,
    });
  }

  questionAnswer(
    params: LemurQuestionAnswerParams,
    signal?: AbortSignal,
  ): Promise<LemurQuestionAnswerResponse> {
    return this.fetchJson<LemurQuestionAnswerResponse>(
      "/lemur/v3/generate/question-answer",
      {
        method: "POST",
        body: JSON.stringify(params),
        signal,
      },
    );
  }

  actionItems(
    params: LemurActionItemsParams,
    signal?: AbortSignal,
  ): Promise<LemurActionItemsResponse> {
    return this.fetchJson<LemurActionItemsResponse>(
      "/lemur/v3/generate/action-items",
      {
        method: "POST",
        body: JSON.stringify(params),
        signal,
      },
    );
  }

  task(
    params: LemurTaskParams,
    signal?: AbortSignal,
  ): Promise<LemurTaskResponse> {
    return this.fetchJson<LemurTaskResponse>("/lemur/v3/generate/task", {
      method: "POST",
      body: JSON.stringify(params),
      signal,
    });
  }

  /**
   * Retrieve a LeMUR response that was previously generated.
   * @param id - The ID of the LeMUR request you previously made. This would be found in the response of the original request.
   * @param signal - Optional AbortSignal to cancel the request
   * @returns The LeMUR response.
   */
  getResponse<T extends LemurResponse>(
    id: string,
    signal?: AbortSignal,
  ): Promise<T>;
  getResponse(id: string, signal?: AbortSignal): Promise<LemurResponse>;
  getResponse(id: string, signal?: AbortSignal): Promise<LemurResponse> {
    return this.fetchJson<LemurResponse>(`/lemur/v3/${id}`, { signal });
  }

  /**
   * Delete the data for a previously submitted LeMUR request.
   * @param id - ID of the LeMUR request
   * @param signal - Optional AbortSignal to cancel the request
   */
  purgeRequestData(
    id: string,
    signal?: AbortSignal,
  ): Promise<PurgeLemurRequestDataResponse> {
    return this.fetchJson<PurgeLemurRequestDataResponse>(`/lemur/v3/${id}`, {
      method: "DELETE",
      signal,
    });
  }
}
