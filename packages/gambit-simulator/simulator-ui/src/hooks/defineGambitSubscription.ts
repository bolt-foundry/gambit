import type {
  ExtractParameters,
  IsographEntrypoint,
  NetworkResponseObject,
  NormalizationAst,
} from "@isograph/react";

export type GambitSubscriptionFlightPolicy = "single" | "multi";

export type GambitSubscriptionOffsetConfig<
  TReadFromStore extends { data: object; parameters: object },
  TEnvelopePayload,
> = {
  variableName: string;
  getOffset: (
    payload: TEnvelopePayload,
    variables: ExtractParameters<TReadFromStore>,
  ) => number | null;
  storageKey?: (variables: ExtractParameters<TReadFromStore>) => string;
};

export type GambitSubscriptionDefinition<
  TReadFromStore extends { data: object; parameters: object },
  TResult,
  TRawResponseType extends NetworkResponseObject,
  TEnvelopePayload = TRawResponseType,
> = {
  entrypoint: IsographEntrypoint<
    TReadFromStore,
    TResult,
    NormalizationAst,
    TRawResponseType
  >;
  query: string;
  operationName?: string;
  toSubscriptionVariables?: (
    variables: ExtractParameters<TReadFromStore>,
  ) => Record<string, unknown>;
  mapPayload?: (
    payload: TEnvelopePayload,
    variables: ExtractParameters<TReadFromStore>,
  ) => TRawResponseType | null;
  flightPolicy: GambitSubscriptionFlightPolicy;
  isEnabled?: (variables: ExtractParameters<TReadFromStore>) => boolean;
  offset?: GambitSubscriptionOffsetConfig<TReadFromStore, TEnvelopePayload>;
};

export function defineGambitSubscription<
  TReadFromStore extends { data: object; parameters: object },
  TResult,
  TRawResponseType extends NetworkResponseObject,
  TEnvelopePayload = TRawResponseType,
>(
  definition: {
    entrypoint: IsographEntrypoint<
      TReadFromStore,
      TResult,
      NormalizationAst,
      TRawResponseType
    >;
    query: string;
    operationName?: string;
    toSubscriptionVariables?: (
      variables: ExtractParameters<TReadFromStore>,
    ) => Record<string, unknown>;
    mapPayload?: (
      payload: TEnvelopePayload,
      variables: ExtractParameters<TReadFromStore>,
    ) => TRawResponseType | null;
    flightPolicy?: GambitSubscriptionFlightPolicy;
    isEnabled?: (variables: ExtractParameters<TReadFromStore>) => boolean;
    offset?: GambitSubscriptionOffsetConfig<TReadFromStore, TEnvelopePayload>;
  },
): GambitSubscriptionDefinition<
  TReadFromStore,
  TResult,
  TRawResponseType,
  TEnvelopePayload
> {
  return {
    ...definition,
    flightPolicy: definition.flightPolicy ?? "single",
  };
}
