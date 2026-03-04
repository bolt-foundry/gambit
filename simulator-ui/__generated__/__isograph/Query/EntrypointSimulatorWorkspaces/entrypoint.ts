import type {IsographEntrypoint, NormalizationAst, RefetchQueryNormalizationArtifactWrapper} from '@isograph/react';
import {Query__EntrypointSimulatorWorkspaces__param} from './param_type.ts';
import {Query__EntrypointSimulatorWorkspaces__output_type} from './output_type.ts';
import type {Query__EntrypointSimulatorWorkspaces__raw_response_type} from './raw_response_type.ts';
import readerResolver from './resolver_reader.ts';
import queryText from './query_text.ts';
import normalizationAst from './normalization_ast.ts';
const nestedRefetchQueries: RefetchQueryNormalizationArtifactWrapper[] = [];

const artifact: IsographEntrypoint<
  Query__EntrypointSimulatorWorkspaces__param,
  Query__EntrypointSimulatorWorkspaces__output_type,
  NormalizationAst,
  Query__EntrypointSimulatorWorkspaces__raw_response_type
> = {
  kind: "Entrypoint",
  networkRequestInfo: {
    kind: "NetworkRequestInfo",
    operation: {
      kind: "Operation",
      text: queryText,
    },
    normalizationAst,
  },
  concreteType: "Query",
  readerWithRefetchQueries: {
    kind: "ReaderWithRefetchQueries",
    nestedRefetchQueries,
    readerArtifact: readerResolver,
  },
};

export default artifact;
