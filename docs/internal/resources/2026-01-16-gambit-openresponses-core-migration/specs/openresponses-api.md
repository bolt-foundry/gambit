+++
scope = "Project"
authority = "spec"
lifecycle = "beta"
area_owner = "engineering"
+++

# Open Responses API Notes

Source: https://www.openresponses.org/

## Overview

Open Responses is an open-source specification and ecosystem for building
multi-provider, interoperable LLM interfaces modeled after the OpenAI
`/v1/responses` API. It defines a shared schema, streaming event model, and
extensible tooling layer.

## Core Concepts

- Items: the atomic unit of input/output (messages, tool calls, reasoning).
- Semantic streaming events: state transitions and deltas, not raw text.
- State machines: responses and items move through defined states.

## HTTP Requirements (from spec)

- Requests use HTTP with `Content-Type: application/json`.
- Non-stream responses return `application/json`.
- Streaming uses `Content-Type: text/event-stream` with JSON data objects.
- Terminal streaming event is the literal string `[DONE]`.
- The SSE `event` field must match the `type` in the event body.

## Endpoint Surface (reference)

- `POST /v1/responses`
- Request accepts JSON or `application/x-www-form-urlencoded`.
- Key fields: `model`, `input`, `tools`, `tool_choice`, `stream`,
  `max_output_tokens`, `reasoning`, `truncation`, and `instructions`.
- Response includes `id`, `object: "response"`, timestamps, `status`, `output`
  items, and tool metadata.

## Acceptance Tests

The Open Responses site includes an acceptance test runner for validating
conformance against the OpenAPI schema. Test cases include basic text, streaming
responses, system prompts, tool calls, image inputs, and multi-turn
conversations.

## References

- Overview: https://www.openresponses.org/
- Specification: https://www.openresponses.org/specification
- Reference (OpenAPI): https://www.openresponses.org/reference
- Acceptance Tests: https://www.openresponses.org/compliance
- Governance: https://www.openresponses.org/governance
