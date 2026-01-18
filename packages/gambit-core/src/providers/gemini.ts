// @ts-ignore: Deno read-only file system
import {
  GoogleGenerativeAI,
  GenerativeModel,
  Content,
  Part,
  FunctionDeclaration,
  FunctionDeclarationSchemaType,
} from "@google/generative-ai";
import type {
  ModelMessage,
  ModelProvider,
  ToolDefinition,
} from "../types.ts";

const logger = console;

// Maps Gambit's ModelMessage to Google's Content format
export function toGoogleContent(messages: ModelMessage[]): Content[] {
  const history: Content[] = [];
  for (const msg of messages) {
    if (msg.role === "system") continue; // Handled in getGenerativeModel

    const parts: Part[] = [];
    if (msg.content && msg.role !== "tool") {
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

export function toGambitToolCalls(
  result: any,
): ModelMessage["tool_calls"] | undefined {
  const calls = result?.response?.candidates?.[0]?.content?.parts
    ?.filter((part: Part) => part.functionCall)
    .map((part: Part) => {
      const fc = part.functionCall!;
      return {
        id: `call_${crypto.randomUUID()}`,
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
  client?: GoogleGenerativeAI;
}): ModelProvider {
  const genAI = opts.client ?? new GoogleGenerativeAI(opts.apiKey);

  return {
    async chat(input) {
      logger.log(
        `[GeminiProvider] Using native Google provider for model: ${input.model}`,
      );

      const systemInstruction = input.messages.find(
        (m) => m.role === "system",
      )?.content;

      // Map Gambit/OpenAI tools to Gemini tools
      const tools = input.tools && input.tools.length > 0
        ? [{
          functionDeclarations: input.tools.map((t): FunctionDeclaration => {
            // Gambit parameters are essentially a JSON schema.
            // We need to ensure it matches FunctionDeclarationSchema.
            // Using 'as any' for the properties/parameters mapping to avoid
            // strict type mismatch between JSONSchema variants, as they are
            // functionally compatible for this use case.
            const params = t.function.parameters as any;
            
            return {
              name: t.function.name,
              description: t.function.description,
              parameters: {
                type: FunctionDeclarationSchemaType.OBJECT,
                properties: params.properties,
                required: params.required,
              },
            };
          }),
        }]
        : undefined;

      const model: GenerativeModel = genAI.getGenerativeModel({
        model: input.model,
        systemInstruction: systemInstruction ?? undefined,
        tools,
      });

      const history = toGoogleContent(input.messages);
      const lastMessage = history.pop();
      if (!lastMessage) {
        throw new Error("No user message found to send.");
      }

      const chat = model.startChat({
        history,
        tools,
      });

      if (input.stream) {
        const streamResult = await chat.sendMessageStream(lastMessage.parts);
        let fullText = "";
        for await (const chunk of streamResult.stream) {
          fullText += chunk.text();
          input.onStreamText?.(chunk.text());
        }
        const response = await streamResult.response;
        const toolCalls = toGambitToolCalls({ response });
        return {
          message: {
            role: "assistant",
            content: fullText,
            tool_calls: toolCalls,
          },
          finishReason: "stop",
          toolCalls: toolCalls?.map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments),
          })),
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
        finishReason: "stop",
        toolCalls: toolCalls?.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments),
        })),
      };
    },
  };
}
