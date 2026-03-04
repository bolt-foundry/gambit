export type Maybe<T> = T | null;

export type Nominal<T, Brand extends string> = T & {
  readonly __brand: Brand;
};
