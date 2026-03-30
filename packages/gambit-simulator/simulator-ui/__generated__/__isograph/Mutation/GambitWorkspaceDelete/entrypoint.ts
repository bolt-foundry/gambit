import type {IsographEntrypoint, NormalizationAst, RefetchQueryNormalizationArtifactWrapper} from '@isograph/react';
import {Mutation__GambitWorkspaceDelete__param} from './param_type.ts';
import {Mutation__GambitWorkspaceDelete__output_type} from './output_type.ts';
import type {Mutation__GambitWorkspaceDelete__raw_response_type} from './raw_response_type.ts';
import readerResolver from './resolver_reader.ts';
import queryText from './query_text.ts';
import normalizationAst from './normalization_ast.ts';
const nestedRefetchQueries: RefetchQueryNormalizationArtifactWrapper[] = [];

const artifact: IsographEntrypoint<
  Mutation__GambitWorkspaceDelete__param,
  Mutation__GambitWorkspaceDelete__output_type,
  NormalizationAst,
  Mutation__GambitWorkspaceDelete__raw_response_type
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
  concreteType: "Mutation",
  readerWithRefetchQueries: {
    kind: "ReaderWithRefetchQueries",
    nestedRefetchQueries,
    readerArtifact: readerResolver,
  },
};

export default artifact;
