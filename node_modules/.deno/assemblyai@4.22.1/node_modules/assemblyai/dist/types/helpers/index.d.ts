export type LiteralUnion<LiteralType, BaseType> = LiteralType | (BaseType & Record<never, never>);
