import type {
  IsographEntrypoint,
  NetworkResponseObject,
  NormalizationAst,
} from "@isograph/react";

export type GambitMutationFlightPolicy = "single" | "multi";

export type GambitMutationDefinition<
  TReadFromStore extends { data: object; parameters: object },
  TResult,
  TRawResponseType extends NetworkResponseObject,
> = {
  entrypoint: IsographEntrypoint<
    TReadFromStore,
    TResult,
    NormalizationAst,
    TRawResponseType
  >;
  flightPolicy: GambitMutationFlightPolicy;
};

export function defineGambitMutation<
  TReadFromStore extends { data: object; parameters: object },
  TResult,
  TRawResponseType extends NetworkResponseObject,
>(
  definition: {
    entrypoint: IsographEntrypoint<
      TReadFromStore,
      TResult,
      NormalizationAst,
      TRawResponseType
    >;
    flightPolicy?: GambitMutationFlightPolicy;
  },
): GambitMutationDefinition<TReadFromStore, TResult, TRawResponseType> {
  return {
    ...definition,
    flightPolicy: definition.flightPolicy ?? "multi",
  };
}
