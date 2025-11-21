import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import type { JSONValue } from "./types.ts";

export function validateWithSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues?.[0];
    const message = issue
      ? `${issue.path.join(".") || "(root)"}: ${issue.message}`
      : result.error.message;
    throw new Error(`Schema validation failed: ${message}`);
  }
  return result.data;
}

export function toJsonSchema(schema: z.ZodTypeAny): Record<string, JSONValue> {
  const converted = zodToJsonSchema(schema, { $refStrategy: "none" });
  if (converted && typeof converted === "object") {
    return converted as Record<string, JSONValue>;
  }
  // Fallback to permissive object if conversion fails
  return { type: "object" };
}

export function assertZodSchema(
  value: unknown,
  label: string,
): asserts value is z.ZodTypeAny {
  if (!value || typeof value !== "object") {
    throw new Error(`${label} must be a Zod schema`);
  }
  // Duck-typing: check for safeParse
  if (typeof (value as { safeParse?: unknown }).safeParse !== "function") {
    throw new Error(`${label} must be a Zod schema (missing safeParse)`);
  }
}
