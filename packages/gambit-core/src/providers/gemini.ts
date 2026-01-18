import {
  GoogleGenerativeAI,
  GenerativeModel,
  Content,
  Part,
  FunctionCallingMode,
  Tool as GoogleTool,
} from "@google/generative-ai";
import type {
  JSONValue,
  ModelMessage,
  ModelProvider,
  ToolDefinition,
} from "../types.ts";

const logger = console;

// Maps Gambit's ModelMessage to Google's Content format
function toGoogleContent(messages: ModelMessage[]): Content[] {
  const history: Content[] = [];
  for (const msg of messages) {
    // Gemini uses "model" for assistant and "user" for user.
    // System messages are handled separately.
    if (msg.role === "system") {
      // Skip for now, will be added to startChat's history
      continue;
    }

    const parts: Part[] = [];
    if (msg.content) {
      parts.push({ text: msg.content });
    }

    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        parts.push({
          functionCall: {
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments),
          },
        });
      }
    }

    if (msg.role === "tool") {
      parts.push({
        functionResponse: {
          name: msg.name!,
          response: {
            name: msg.name!,
            content: msg.content,
          },
        },
      });
    }

    history.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts,
    });
  }
  return history;
}

// Maps Google's tools to Gambit's format
function toGambitToolCalls(
  result: any,
): ModelMessage["tool_calls"] | undefined {
  const calls = result?.response?.candidates?.[0]?.content?.parts
    ?.filter((part: Part) => part.functionCall)
    .map((part: Part) => {
      const fc = part.functionCall!;
      return {
        id: `call_${crypto.randomUUID()}`, // Gemini doesn't provide IDs
        type: "function" as const,
        function: {
          name: fc.name,
          arguments: JSON.stringify(fc.args),
        },
      };
    });

  return calls && calls.length > 0 ? calls : undefined;
}

export function createGeminiProvider(opts: {
  apiKey: string;
}): ModelProvider {
  const genAI = new GoogleGenerativeAI(opts.apiKey);

  return {
    async chat(input: {
      model: string;
      messages: Array<ModelMessage>;
      tools?: Array<ToolDefinition>;
      stream?: boolean;
      onStreamText?: (chunk: string) => void;
      params?: Record<string, unknown>;
    }) {
      logger.log(
        `[GeminiProvider] Using native Google provider for model: ${input.model}`,
      );

      const systemInstruction = input.messages.find(
        (m) => m.role === "system",
      )?.content;

      const model: GenerativeModel = genAI.getGenerativeModel({
        model: input.model,
        systemInstruction: systemInstruction
          ? { role: "system", parts: [{ text: systemInstruction }] }
          : undefined,
        tools: input.tools
          ? [{ functionDeclarations: input.tools.map((t) => t.function) }]
          : undefined,
      });

      const history = toGoogleContent(input.messages);
      const lastMessage = history.pop();
      if (!lastMessage) {
        throw new Error("No user message found to send.");
      }

      const chat = model.startChat({
        history,
        tools: input.tools
          ? [{ functionDeclarations: input.tools.map((t) => t.function) as any }]
          : undefined,
      });

      if (input.stream) {
        const streamResult = await chat.sendMessageStream(lastMessage.parts);

        let fullText = "";
        for await (const chunk of streamResult.stream) {
          const chunkText = chunk.text();
          if (chunkText) {
            fullText += chunkText;
            input.onStreamText?.(chunkText);
          }
        }

        const toolCalls = toGambitToolCalls({ response: await streamResult.response });

        return {
          message: {
            role: "assistant",
            content: fullText,
            tool_calls: toolCalls,
          },
          finishReason: "stop", // Gemini SDK doesn't directly expose this yet
          toolCalls: toolCalls?.map(tc => ({ id: tc.id, name: tc.function.name, args: JSON.parse(tc.function.arguments) })),
          // Usage data is not yet available in the Node SDK for streaming
        };
      }

      const result = await chat.sendMessage(lastMessage.parts);

      const toolCalls = toGambitToolCalls(result);

      return {
        message: {
          role: "assistant",
          content: result.response.text(),
          tool_calls: toolCalls,
        },
        finishReason: "stop", // Or map from `result.response.candidates[0].finishReason`
        toolCalls: toolCalls?.map(tc => ({ id: tc.id, name: tc.function.name, args: JSON.parse(tc.function.arguments) })),
        // usage: ... not easily available
      };
    },
  };
}
