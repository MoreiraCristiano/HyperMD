# HyperMD Architecture

HyperMD uses a small feature-oriented architecture. The goal is to keep ownership obvious without introducing framework-specific infrastructure.

## Source areas

- `src/app`: application composition, command dispatch, keyboard handling, and lifecycle coordination.
- `src/features`: user-facing capabilities. Each feature owns its state, services, components, and public `index.ts`.
- `src/shared`: UI and utilities that do not know about application features.
- `src/platform`: adapters around Tauri and other host APIs.
- `src/styles`: ordered global styles. Editor styles remain global because Tiptap and CodeMirror create DOM outside Svelte component scoping.

Dependencies flow from `app` to `features`, then to `shared` and `platform`. Shared and platform code never imports a feature or the app. Cross-feature dependencies use the target feature's public `index.ts`.

## Responsibility rules

- Svelte components render UI and hold short-lived interaction state.
- Stores hold shared reactive state and synchronous state transitions.
- Services own asynchronous workflows and business rules.
- Platform adapters are the only modules that import `@tauri-apps/*`.
- Pure helpers stay independent of Svelte and Tauri when possible.
- A large cohesive editor extension may remain one file; line count alone is not a reason to split it.

Use the `@/` alias for cross-area imports. Use relative imports within the same feature. Export only the feature API needed by consumers.

## Themes

- `src/styles/tokens.css` owns theme-independent typography and dimensions.
- `src/styles/themes/dark.css` and `light.css` implement the same color-token contract.
- Components consume CSS variables only; raw color values stay inside theme files.
- New styles should prefer semantic `--color-*`, `--code-*`, and `--syntax-*` tokens. The `--tone-*` compatibility palette preserves the original dark theme pixel-for-pixel.
- The persisted preference is `dark`, `light`, or `system`; the resolved theme is written to `data-theme` on the root element.

## Change checklist

1. Put new behavior in the feature that owns it.
2. Keep host access behind a platform adapter.
3. Avoid importing another feature's internal files.
4. Add focused tests beside the changed module.
5. Run `npm run check`, `npm test`, and `npm run build`.

`src/architecture.test.ts` enforces the dependency direction, public feature entrypoints, and Tauri isolation.
