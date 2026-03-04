/// <reference lib="deno.unstable" />

const plugin = {
  name: "gambit",
  rules: {
    "examples-remote-imports": {
      create(context: any) {
        const filename: string = context.filename || "";
        if (!filename.includes("packages/gambit/init/")) {
          return {};
        }
        const allowedPrefixes = /^(?:\.{1,2}\/|npm:|jsr:|https?:|data:|blob:)/;
        function report(node: any, literal: any) {
          const source = literal?.value;
          if (typeof source !== "string") return;
          if (allowedPrefixes.test(source)) return;
          context.report({
            node: literal,
            message:
              "Use explicit npm:/jsr:/URL specifiers (or relative paths) in Gambit example imports.",
          });
        }
        return {
          ImportDeclaration(node: any) {
            report(node, node.source);
          },
          ExportAllDeclaration(node: any) {
            report(node, node.source);
          },
          ExportNamedDeclaration(node: any) {
            if (node.source) report(node, node.source);
          },
          'CallExpression[callee.type="Import"]'(node: any) {
            const arg = node.arguments?.[0];
            if (arg?.type === "Literal") report(node, arg);
          },
        };
      },
    },
    "use-maybe-type": {
      create(context: any) {
        let hasMaybeImport = false;

        const sourceCode = context.sourceCode;
        if (!sourceCode) return {};

        const toSimpleName = (node: any): string | null => {
          if (!node) return null;
          if (node.type === "Identifier") return node.name ?? null;
          if (
            node.type === "TSQualifiedName" &&
            node.right?.type === "Identifier"
          ) {
            return node.right.name ?? null;
          }
          return null;
        };

        const isMaybeReference = (node: any): boolean => {
          if (!node || node.type !== "TSTypeReference") return false;
          return toSimpleName(node.typeName) === "Maybe";
        };

        const extractBinaryNullUnion = (
          node: any,
        ): { wrapped: any; inner: any; other: any } | null => {
          const wrapped = node?.type === "TSParenthesizedType" ? node : null;
          const inner = wrapped?.typeAnnotation ?? node;
          if (!inner || inner.type !== "TSUnionType") return null;
          if (!Array.isArray(inner.types) || inner.types.length !== 2) {
            return null;
          }
          const [left, right] = inner.types;
          if (!left || !right) return null;
          if (isMaybeReference(left) || isMaybeReference(right)) return null;
          if (left.type === "TSNullKeyword") {
            return { wrapped, inner, other: right };
          }
          if (right.type === "TSNullKeyword") {
            return { wrapped, inner, other: left };
          }
          return null;
        };

        return {
          ImportDeclaration(node: any) {
            const source = node.source?.value;
            if (typeof source !== "string") return;
            if (!source.includes("utility_types")) return;
            const specifiers = Array.isArray(node.specifiers)
              ? node.specifiers
              : [];
            for (const specifier of specifiers) {
              if (
                specifier?.type === "ImportSpecifier" &&
                specifier.imported?.type === "Identifier" &&
                specifier.imported.name === "Maybe"
              ) {
                hasMaybeImport = true;
                return;
              }
            }
          },
          TSUnionType(node: any) {
            if (!hasMaybeImport) return;
            if (node.parent?.type === "TSParenthesizedType") return;
            const match = extractBinaryNullUnion(node);
            if (!match) return;

            context.report({
              node: match.inner,
              message: "Use Maybe<T> instead of T | null.",
              fix(fixer: any) {
                const replacement = `Maybe<${sourceCode.getText(match.other)}>`;
                if (match.wrapped) {
                  return fixer.replaceText(match.wrapped, replacement);
                }
                return fixer.replaceText(match.inner, replacement);
              },
            });
          },
          TSParenthesizedType(node: any) {
            if (!hasMaybeImport) return;
            const match = extractBinaryNullUnion(node);
            if (!match) return;

            context.report({
              node: match.wrapped ?? match.inner,
              message: "Use Maybe<T> instead of T | null.",
              fix(fixer: any) {
                const replacement = `Maybe<${sourceCode.getText(match.other)}>`;
                return fixer.replaceText(
                  match.wrapped ?? match.inner,
                  replacement,
                );
              },
            });
          },
        };
      },
    },
    "no-useeffect-setstate": {
      create(context: any) {
        const { sourceCode } = context;
        const filename: string = context.filename || "";

        function hasReactImport(): boolean {
          const body = sourceCode.ast?.body ?? [];
          return body.some(
            (node: any) =>
              node.type === "ImportDeclaration" &&
              typeof node.source?.value === "string" &&
              /^npm:react$|^react$/.test(node.source.value),
          );
        }

        function isReactFile(): boolean {
          if (filename.endsWith(".tsx") || filename.endsWith(".jsx")) {
            return true;
          }
          return hasReactImport();
        }

        if (!isReactFile()) {
          return {};
        }

        const scopeStack: Array<Set<string>> = [new Set()];

        function currentSetters(): Set<string> {
          return scopeStack[scopeStack.length - 1];
        }

        function isUseStateCall(init: any): boolean {
          if (!init) return false;
          const call = init.type === "AwaitExpression" ? init.argument : init;
          if (!call || call.type !== "CallExpression") return false;
          const callee = call.callee;
          if (!callee) return false;
          if (callee.type === "Identifier" && callee.name === "useState") {
            return true;
          }
          if (
            callee.type === "MemberExpression" &&
            callee.property?.type === "Identifier" &&
            callee.property.name === "useState"
          ) {
            return true;
          }
          return false;
        }

        function isUseEffectCall(node: any): boolean {
          const callee = node.callee;
          if (!callee) return false;
          if (callee.type === "Identifier" && callee.name === "useEffect") {
            return true;
          }
          if (
            callee.type === "MemberExpression" &&
            callee.property?.type === "Identifier" &&
            callee.property.name === "useEffect"
          ) {
            return true;
          }
          return false;
        }

        function collectSetterCalls(
          node: any,
          setters: Set<string>,
          found: Set<string>,
        ) {
          if (!node || setters.size === 0) return;
          if (node.type === "CallExpression") {
            const callee = node.callee;
            if (callee?.type === "Identifier" && setters.has(callee.name)) {
              found.add(callee.name);
            }
          }

          for (const key in node) {
            const value = (node as any)[key];
            if (!value) continue;
            if (Array.isArray(value)) {
              for (const child of value) {
                collectSetterCalls(child, setters, found);
              }
            } else if (typeof value === "object") {
              collectSetterCalls(value, setters, found);
            }
          }
        }

        function trackUseStateDeclarator(node: any) {
          if (!node || node.type !== "VariableDeclarator") return;
          if (!isUseStateCall(node.init)) return;
          if (!node.id || node.id.type !== "ArrayPattern") return;
          const elements = node.id.elements ?? [];
          const setter = elements[1];
          if (setter && setter.type === "Identifier") {
            currentSetters().add(setter.name);
          }
        }

        return {
          Program() {
            scopeStack.length = 0;
            scopeStack.push(new Set());
          },

          FunctionDeclaration() {
            scopeStack.push(new Set());
          },
          "FunctionDeclaration:exit"() {
            scopeStack.pop();
          },

          FunctionExpression() {
            scopeStack.push(new Set());
          },
          "FunctionExpression:exit"() {
            scopeStack.pop();
          },

          ArrowFunctionExpression() {
            scopeStack.push(new Set());
          },
          "ArrowFunctionExpression:exit"() {
            scopeStack.pop();
          },

          VariableDeclarator(node: any) {
            trackUseStateDeclarator(node);
          },

          CallExpression(node: any) {
            if (!isUseEffectCall(node)) return;
            const setters = currentSetters();
            if (setters.size === 0) return;

            const callback = node.arguments?.[0];
            if (
              !callback ||
              (callback.type !== "ArrowFunctionExpression" &&
                callback.type !== "FunctionExpression")
            ) {
              return;
            }

            const found = new Set<string>();
            collectSetterCalls(callback.body, setters, found);
            if (found.size === 0) return;

            const setterList = Array.from(found).sort().join(", ");
            const message =
              `Avoid calling useState setters inside useEffect callbacks (${setterList}). Prefer derived state, conditional effects, or event-driven updates.`;

            context.report({
              node,
              message,
            });
          },
        };
      },
    },
    "no-unexplained-as-unknown": {
      create(context: any) {
        const filename = String(context.filename ?? "");
        const isTestFile = /(^|\/)(?:__tests__|tests)(\/|$)/.test(filename) ||
          /\.test\.[cm]?[jt]sx?$/.test(filename) ||
          /\.spec\.[cm]?[jt]sx?$/.test(filename);
        if (isTestFile) return {};

        const sourceCode = context.sourceCode;
        if (!sourceCode) return {};

        return {
          Program(node: any) {
            const text = sourceCode.getText();
            const lines = text.split("\n");
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              if (!/\bas\s+unknown\b/.test(line)) continue;
              const trimmed = line.trim();
              const hasInlineComment = trimmed.includes("//") ||
                trimmed.includes("/*");
              let hasPreviousComment = false;
              for (let j = i - 1; j >= 0; j--) {
                const previous = lines[j].trim();
                if (previous.length === 0) continue;
                hasPreviousComment = previous.startsWith("//") ||
                  previous.startsWith("/*") ||
                  previous.startsWith("*");
                break;
              }
              if (hasInlineComment || hasPreviousComment) continue;
              context.report({
                node,
                message:
                  "as unknown should have a comment explaining why it's needed, and ideally not be used.",
              });
            }
          },
        };
      },
    },
  },
};

export default plugin;
