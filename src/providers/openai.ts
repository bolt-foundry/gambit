import OpenAI from "@openai/openai";
import type {
  ModelProvider,
  OpenResponseCreateRequest,
  OpenResponseCreateResponse,
  OpenResponseEvent,
} from "@bolt-foundry/gambit-core";

const openResponseEventTypes = new Set([
  "response.output_text.delta",
  "response.output_text.done",
  "response.output_item.added",
  "response.output_item.done",
  "response.content_part.added",
  "response.content_part.done",
  "response.function_call_arguments.delta",
  "response.function_call_arguments.done",
  "response.refusal.delta",
  "response.refusal.done",
  "response.reasoning.delta",
  "response.reasoning.done",
  "response.reasoning_summary_text.delta",
  "response.reasoning_summary_text.done",
  "response.reasoning_summary_part.added",
  "response.reasoning_summary_part.done",
  "response.created",
  "response.queued",
  "response.in_progress",
  "response.failed",
  "response.incomplete",
  "response.completed",
  "error",
]);

type ResponsesRequestInput = OpenResponseCreateRequest & {
  onStreamEvent?: (event: OpenResponseEvent) => void;
};

function buildResponsesRequest(
  input: ResponsesRequestInput,
): OpenAI.Responses.ResponseCreateParams {
  const {
    params: _params,
    state: _state,
    onStreamEvent: _onStreamEvent,
    ...request
  } = input;
  return request as OpenAI.Responses.ResponseCreateParams;
}

export function createOpenAIProvider(opts: {
  apiKey: string;
  baseURL?: string;
}): ModelProvider {
  const client = new OpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL ?? "https://api.openai.com/v1",
  });

  return {
    async responses(input) {
      const request = buildResponsesRequest(input);
      if (input.stream) {
        let sequence = 0;
        let terminalResponse: OpenResponseCreateResponse | undefined;
        const stream = await client.responses.create({
          ...request,
          stream: true,
        });
        for await (
          const event of stream as AsyncIterable<
            { type?: string; response?: OpenResponseCreateResponse }
          >
        ) {
          if (!event || !event.type) continue;
          if (openResponseEventTypes.has(event.type)) {
            const streamEvent = event as OpenResponseEvent;
            input.onStreamEvent?.({
              ...streamEvent,
              sequence_number: streamEvent.sequence_number ?? ++sequence,
            });
          }
          if (
            event.type === "response.completed" ||
            event.type === "response.failed" ||
            event.type === "response.incomplete"
          ) {
            terminalResponse = event.response as OpenResponseCreateResponse;
          }
        }
        if (!terminalResponse) {
          throw new Error(
            "OpenAI responses stream ended without terminal response.",
          );
        }
        return terminalResponse;
      }

      return (await client.responses.create(
        request,
      ) as unknown) as OpenResponseCreateResponse;
    },
  };
}
