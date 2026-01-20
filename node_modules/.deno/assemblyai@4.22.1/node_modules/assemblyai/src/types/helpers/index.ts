// source: https://github.com/sindresorhus/type-fest/blob/main/source/literal-union.d.ts
export type LiteralUnion<LiteralType, BaseType> =
  | LiteralType
  | (BaseType & Record<never, never>);
