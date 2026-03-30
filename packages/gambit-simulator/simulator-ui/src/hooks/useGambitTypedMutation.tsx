import {
  type ExtractParameters,
  type FetchOptions,
  type NetworkResponseObject,
  useImperativeReference,
} from "@isograph/react";
import { useCallback, useRef, useState } from "react";
import type { GambitMutationDefinition } from "./defineGambitMutation.ts";

export function useGambitTypedMutation<
  TReadFromStore extends { data: object; parameters: object },
  TResult,
  TRawResponseType extends NetworkResponseObject,
>(
  mutation: GambitMutationDefinition<TReadFromStore, TResult, TRawResponseType>,
) {
  const { loadFragmentReference: commit } = useImperativeReference(
    mutation.entrypoint,
  );
  const [inFlight, setInFlight] = useState(false);
  const inFlightRef = useRef(false);

  const commitWithDefault = useCallback((
    variables: ExtractParameters<TReadFromStore>,
    fetchOptions?: FetchOptions<TResult, TRawResponseType>,
  ) => {
    const isSingleFlight = mutation.flightPolicy === "single";
    if (isSingleFlight && inFlightRef.current) return;

    if (isSingleFlight) {
      inFlightRef.current = true;
      setInFlight(true);
    }

    const clearInFlight = () => {
      inFlightRef.current = false;
      setInFlight(false);
    };

    const finalOptions: FetchOptions<TResult, TRawResponseType> = {
      shouldFetch: fetchOptions?.shouldFetch ?? "Yes",
      ...(fetchOptions ?? {}),
    };

    if (isSingleFlight) {
      const originalOnComplete = finalOptions.onComplete;
      const originalOnError = finalOptions.onError;
      finalOptions.onComplete = (...args: Array<unknown>) => {
        clearInFlight();
        if (typeof originalOnComplete === "function") {
          (originalOnComplete as (...args: Array<unknown>) => unknown)(...args);
        }
      };
      finalOptions.onError = (...args: Array<unknown>) => {
        clearInFlight();
        if (typeof originalOnError === "function") {
          (originalOnError as (...args: Array<unknown>) => unknown)(...args);
        }
      };
    }

    try {
      commit(variables, finalOptions);
    } catch (error) {
      if (isSingleFlight) {
        clearInFlight();
      }
      throw error;
    }
  }, [commit, mutation.flightPolicy]);

  return { commit: commitWithDefault, inFlight } as const;
}
