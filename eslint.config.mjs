// @ts-check
// .mjs rather than .js: eslint-plugin-react-refresh ships ESM-only, and
// this project's package.json "type": "commonjs" means a plain .js config
// file's require() can't load it correctly (Node's CJS/ESM interop for an
// ESM-only package via require() doesn't reliably expose its exports).
// Naming it .mjs sidesteps that entirely — real import works for both this
// and the CJS packages (eslint, typescript-eslint) regardless.
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  {
    ignores: ["dist-electron/**", "dist/**", "release/**", "node_modules/**"],
  },
  ...tseslint.configs.recommended,
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // Only the two long-standing hook rules, not the rest of v7's
      // "recommended" bundle: that now also includes a batch of React-
      // Compiler-readiness rules (set-state-in-effect, purity,
      // immutability, …) aimed at code that opts into the compiler. This
      // is a plain React 18 app with no compiler in the pipeline, and
      // those rules flag perfectly correct, idiomatic patterns already in
      // use here (setState in an effect to reset state on a prop change,
      // useState(Date.now()) for a live clock) as errors — "fixing" those
      // would make the code worse, not better, for a rule set this
      // project isn't targeting.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Vite's fast-refresh only works when a component file exports just
      // components — catches the easy mistake of exporting a stray
      // constant/helper alongside one and silently losing fast refresh for
      // that file. `allowConstantExport` covers the common, legitimate
      // case of a file also exporting a plain constant (e.g. GROUPS in
      // KeyboardShortcuts.tsx, reused by Settings.tsx).
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    // Deliberately as permissive as the rest of the codebase's own existing
    // style: tsconfig's own noUnusedLocals/noUnusedParameters are both
    // off, and plenty of IPC handlers take a first `_event` parameter they
    // don't use — this isn't the place to start enforcing stricter unused-
    // var rules than the project already lives with.
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      // Plenty of IPC payloads and third-party shapes are legitimately
      // typed as `any` at the boundary (JSON from disk, ssh2 callbacks) —
      // this project doesn't try to eliminate that, just discourage new
      // *unnecessary* any's via review, not a hard lint error.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
