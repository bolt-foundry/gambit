'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true,
});
exports.mutationWithClientMutationId = mutationWithClientMutationId;
var _graphql = require('graphql');
/**
 * A description of a mutation consumable by mutationWithClientMutationId
 * to create a GraphQLFieldConfig for that mutation.
 *
 * The inputFields and outputFields should not include `clientMutationId`,
 * as this will be provided automatically.
 *
 * An input object will be created containing the input fields, and an
 * object will be created containing the output fields.
 *
 * mutateAndGetPayload will receive an Object with a key for each
 * input field, and it should return an Object with a key for each
 * output field. It may return synchronously, or return a Promise.
 */

/**
 * Returns a GraphQLFieldConfig for the mutation described by the
 * provided MutationConfig.
 */
function mutationWithClientMutationId(config) {
  const { name, inputFields, outputFields, mutateAndGetPayload } = config;
  const augmentedInputFields = () => ({
    ...(0, _graphql.resolveObjMapThunk)(inputFields),
    clientMutationId: {
      type: _graphql.GraphQLString,
    },
  });
  const augmentedOutputFields = () => ({
    ...(0, _graphql.resolveObjMapThunk)(outputFields),
    clientMutationId: {
      type: _graphql.GraphQLString,
    },
  });
  const outputType = new _graphql.GraphQLObjectType({
    name: name + 'Payload',
    fields: augmentedOutputFields,
  });
  const inputType = new _graphql.GraphQLInputObjectType({
    name: name + 'Input',
    fields: augmentedInputFields,
  });
  return {
    type: outputType,
    description: config.description,
    deprecationReason: config.deprecationReason,
    extensions: config.extensions,
    args: {
      input: {
        type: new _graphql.GraphQLNonNull(inputType),
      },
    },
    resolve: (_, { input }, context, info) => {
      const { clientMutationId } = input;
      const payload = mutateAndGetPayload(input, context, info);
      if (isPromiseLike(payload)) {
        return payload.then(injectClientMutationId);
      }
      return injectClientMutationId(payload);
      function injectClientMutationId(data) {
        if (typeof data === 'object' && data !== null) {
          // @ts-expect-error FIXME It's bad idea to mutate data but we need to pass clientMutationId somehow. Maybe in future we figure out better solution satisfying all our test cases.
          data.clientMutationId = clientMutationId;
        }
        return data;
      }
    },
  };
}

// FIXME: Temporary until graphql-js resolves this issue
// See, https://github.com/graphql/graphql-js/pull/3243#issuecomment-919510590
function isPromiseLike(value) {
  return (
    typeof (value === null || value === void 0 ? void 0 : value.then) ===
    'function'
  );
}
