import type {
  ModelMessage,
  OpenResponseContentPart,
  OpenResponseItem,
} from "./types.ts";

function contentText(parts: Array<OpenResponseContentPart>): string {
  return parts.map((part) => {
    switch (part.type) {
      case "input_text":
      case "output_text":
      case "text":
      case "summary_text":
      case "reasoning_text":
        return part.text;
      case "refusal":
        return part.refusal;
      default:
        return "";
    }
  }).join("");
}

export function openResponseItemFromMessage(
  message: ModelMessage,
): OpenResponseItem {
  return {
    type: "message",
    role: message.role,
    content: message.content,
    name: message.name,
    tool_call_id: message.tool_call_id,
    tool_calls: message.tool_calls,
  };
}

export function messageFromOpenResponseItem(
  item: OpenResponseItem,
): ModelMessage | null {
  switch (item.type) {
    case "message":
      return {
        role: item.role,
        content: typeof item.content === "string" || item.content === null
          ? item.content
          : contentText(item.content),
        name: item.name,
        tool_call_id: item.tool_call_id,
        tool_calls: item.tool_calls,
      };
    case "function_call":
      return {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: item.call_id,
            type: "function",
            function: { name: item.name, arguments: item.arguments },
          },
        ],
      };
    case "function_call_output":
      return {
        role: "tool",
        content: item.output,
        tool_call_id: item.call_id,
      };
    case "output_text":
      return {
        role: "assistant",
        content: item.text,
      };
    case "reasoning":
    case "item_reference":
    default:
      return null;
  }
}

export function openResponseItemsFromMessages(
  messages: Array<ModelMessage>,
): Array<OpenResponseItem> {
  return messages.map(openResponseItemFromMessage);
}

export function messagesFromOpenResponseOutput(
  output: Array<OpenResponseItem>,
): Array<ModelMessage> {
  return output
    .map(messageFromOpenResponseItem)
    .filter((message): message is ModelMessage => message !== null);
}
