// @ts-ignore: Deno read-only file system
import {
  GoogleGenerativeAI,
  GenerativeModel,
  Content,
  Part,
  FunctionDeclaration,
  FunctionDeclarationSchema,
  FunctionDeclarationSchemaProperty,
  Schema,
  SchemaType,
} from "@google/generative-ai";
import type {
  ModelMessage,
  ModelProvider,
} from "../types.ts";

const logger = console;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

// Maps Gambit's ModelMessage to Google's Content format
export function toGoogleContent(
  messages: ModelMessage[],
  opts: { allowFunctionCalls?: boolean } = {},
): Content[] {
  const allowFunctionCalls = opts.allowFunctionCalls ?? true;
  const history: Content[] = [];
  for (const msg of messages) {
    if (msg.role === "system") continue; // Handled separately

    if (msg.role === "tool") {
      if (!allowFunctionCalls) {
        continue;
      }
      const toolName = msg.name ?? "tool";
      const toolContent = typeof msg.content === "string" ? msg.content : "";
      history.push({
        role: "user",
        parts: [{ text: `[${toolName}]: ${toolContent}` }],
      });
      continue;
    }

    const parts: Part[] = [];
    if (msg.content) {
      parts.push({ text: msg.content });
    }
    if (parts.length === 0 && msg.role !== "assistant") {
      parts.push({ text: "" });
    }

    if (allowFunctionCalls && msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        parts.push({
          functionCall: {
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments),
          },
        });
      }
    }

    if (parts.length === 0) {
      continue;
    }

    const role = msg.role === "assistant" ? "model" : "user";
    history.push({ role, parts });
  }
  if (history.length > 0 && history[0].role === "model") {
    history.unshift({ role: "user", parts: [{ text: "" }] });
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
  const apiVersion = Deno.env.get("GOOGLE_API_VERSION") ?? "default";
  const resolvedApiVersion = apiVersion === "default" ? "v1beta" : apiVersion;

  return {
    async chat(input) {
      logger.log(
        `[GeminiProvider] Using native Google provider for model: ${input.model} (apiVersion=${apiVersion} [${resolvedApiVersion}])`,
      );


      const systemInstruction = input.messages.find(
        (m) => m.role === "system",
      )?.content;

      // Map Gambit/OpenAI tools to Gemini tools
      const tools = input.tools && input.tools.length > 0
        ? [{
          functionDeclarations: input.tools.map((t): FunctionDeclaration => {
            const rawParams = t.function.parameters;
            const rawType = isRecord(rawParams) ? rawParams.type : undefined;
            const rawProps = isRecord(rawParams) ? rawParams.properties : undefined;
            const rawRequired = isRecord(rawParams) ? rawParams.required : undefined;

            const schemaType = typeof rawType === "string" && rawType.toLowerCase() === "object"
              ? SchemaType.OBJECT
              : SchemaType.OBJECT;

            const properties: Record<string, FunctionDeclarationSchemaProperty> = isRecord(rawProps)
              ? Object.fromEntries(
                Object.entries(rawProps).map(([key, value]) => {
                  const schemaValue: Schema = isRecord(value)
                    ? (value as unknown as Schema)
                    : { type: SchemaType.STRING };
                  return [key, schemaValue];
                }),
              )
              : {};

            const parameters: FunctionDeclarationSchema = {
              type: schemaType,
              properties,
              required: isStringArray(rawRequired) ? rawRequired : undefined,
            };

            return {
              name: t.function.name,
              description: t.function.description,
              parameters,
            };
          }),
        }]
        : undefined;

      const baseModelParams = {
        model: input.model,
        tools,
      };

      const systemContent = systemInstruction && systemInstruction.trim()
        ? ({ role: "user", parts: [{ text: systemInstruction }] } as Content)
        : undefined;

      const history = toGoogleContent(
        input.messages.filter((msg) => msg.role !== "system"),
        { allowFunctionCalls: Boolean(tools && tools.length > 0) },
      );

      if (systemContent) {
        history.unshift(systemContent);
      }

      const lastMessage = history.pop();
      if (!lastMessage) {
        throw new Error("No user message found to send.");
      }

      if (lastMessage.role === "model") {
        history.push({ role: "user", parts: [{ text: "" }] });
        history.push(lastMessage);
      } else {
        history.push(lastMessage);
      }

      const userMessage = history.pop();
      if (!userMessage || userMessage.role !== "user") {
        throw new Error("No user message found to send.");
      }

      const model: GenerativeModel = genAI.getGenerativeModel(
        baseModelParams,
      );

      const chat = model.startChat({
        history,
        tools,
      });


      if (input.stream) {
        const streamResult = await chat.sendMessageStream(userMessage.parts);
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

      const result = await chat.sendMessage(userMessage.parts);
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
