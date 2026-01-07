/// <reference lib="deno.unstable" />

const plugin = {
  name: "gambit",
  rules: {
    "examples-remote-imports": {
      create(context: any) {
        const filename: string = context.filename || "";
        if (!filename.includes("packages/gambit/examples/")) {
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
  },
};

export default plugin;
