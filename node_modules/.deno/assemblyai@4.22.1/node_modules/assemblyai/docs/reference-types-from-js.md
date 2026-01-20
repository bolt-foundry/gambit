# Reference types from JavaScript

Types are automatically configured in most IDEs when you import the `assemblyai` module using `require` or `import`.
However, if you're using the _assemblyai.umd.js_ or _assemblyai.umd.min.js_ script,
you need to manually reference the types.

1. Install the `assemblyai` module locally.
2. Create an _assemblyai.d.ts_ file with the following content.
   ```typescript
   import AssemblyAIModule from "assemblyai";
   declare global {
     const assemblyai: typeof AssemblyAIModule;
   }
   ```
   This will import the TypeScript types from the `assemblyai` module,
   and configure them as the global `assemblyai` variable.
3. Reference the _assemblyai.d.ts_ file at the top of your script file.

   ```js
   /// <reference path="assemblyai.d.ts" />
   const { RealtimeTranscriber } = assemblyai;
   ...
   ```

   Your IDE will load the types specified in the `<reference />` tag.

   > [!INFO] > `/// <reference />` tags only work in script files, not script-blocks, and should be at the top of the file.
