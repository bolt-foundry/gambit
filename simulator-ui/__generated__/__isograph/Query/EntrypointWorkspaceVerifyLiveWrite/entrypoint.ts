import type {IsographEntrypoint, NormalizationAst, RefetchQueryNormalizationArtifactWrapper} from '@isograph/react';
import {Query__EntrypointWorkspaceVerifyLiveWrite__param} from './param_type.ts';
import {Query__EntrypointWorkspaceVerifyLiveWrite__output_type} from './output_type.ts';
import type {Query__EntrypointWorkspaceVerifyLiveWrite__raw_response_type} from './raw_response_type.ts';
import readerResolver from './resolver_reader.ts';
import queryText from './query_text.ts';
import normalizationAst from './normalization_ast.ts';
const nestedRefetchQueries: RefetchQueryNormalizationArtifactWrapper[] = [];

const artifact: IsographEntrypoint<
  Query__EntrypointWorkspaceVerifyLiveWrite__param,
  Query__EntrypointWorkspaceVerifyLiveWrite__output_type,
  NormalizationAst,
  Query__EntrypointWorkspaceVerifyLiveWrite__raw_response_type
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
