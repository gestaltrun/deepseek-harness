# Model Center

English | [中文](README.zh.md)

`@gestaltrun/dsh-model-center` provides the Models settings page and per-model reasoning defaults. Its bundle selects the product provider and editor while keeping the official LLM service, pi-ai implementation, Settings and Credentials services. Desktop carries the package and activates it for a new profile; disabling it restores the original provider and Models page without removing saved configuration.

## Configuration

The Models page edits input types, offered reasoning efforts, wire values, and a default effort in the same model row. Provider creation and editing also expose `defaultInput`. Configuration remains under `llm-pi-ai.providers`; API keys remain in the Credentials service.

While Model Center is active, its inline controls take the pi-ai provider-card slot, so an installed legacy capability plugin does not render a duplicate panel. Other provider extensions and the disabled-provider archive remain available. Disabling Model Center restores the legacy contribution without uninstalling it or deleting its data.

```yaml
llm-pi-ai:
  providers:
    gateway:
      api: openai-completions
      baseURL: https://gateway.example/v1
      apiKeyEnv: GATEWAY_API_KEY
      models:
        - id: vision-model
          input: [text, image]
          reasoningEfforts: {off: null, low: low, high: high}
          defaultReasoningLevel: high
```

An explicit request selection takes precedence over the model default, which takes precedence over the provider's `reasoning` value. Removing `defaultReasoningLevel` restores inheritance. Declared levels and defaults must agree; a catalog-inherited default is checked against resolved model metadata before dispatch. `off: null` offers the disabled effort without sending a reasoning parameter. Capabilities are declarations, not automatic endpoint detection.

Settings writes retain unknown model fields, carry the editor's namespace revision, and save the model array atomically. Existing `defaultReasoningLevel` fields are consumed in place; no credential copy or destructive migration is required. Prepared calls retain their resolved defaults when settings change. Provider errors, cancellation, retries, images and replay state continue through the official implementation.

A product bundle can reserve provider routes with `managedProviders` before pi-ai reads its initial settings. The runtime owner publishes source model fields through `ctx.modelCenter`; publication writes the existing `llm-pi-ai.providers.<id>.models` user layer and preserves other providers and non-source fields. The generic pi-ai adapter does not claim or validate reserved routes. The runtime owner remains responsible for their adapter, credentials, discovery, and lifecycle. Repeating an unchanged source catalog does not write Settings; a later source refresh replaces manual edits to source-owned model fields.

## Build and composition

The independent workspace is under `product/`. Run `pnpm --dir product install --frozen-lockfile --ignore-scripts`, then `pnpm --dir product run build`, `test`, or `typecheck`. `pnpm --dir product run pack` writes the npm archive into `product/dist`. Desktop's package preparation consumes that directory and the product bundle list in `apps/desktop/src/product-profile.ts`.

The bundle disables the standard pi-ai and Models UI rows and inserts its product row. Composition-level pi-ai defaults belong on the product row when used; existing user settings keep their original namespace. Model Center declares no managed route by default; the bundle that owns a managed runtime adds its reservation to the Model Center row. The provider's isolated registration view forwards the three official LLM registration methods and the official settings-installation method. Combination tests own compatibility with the pinned DSH release. This package does not replace the application LLM service or modify frozen requests in middleware.

The Models page and input-tag controls are maintained source adaptations; source identities are recorded in `UPSTREAM.json`. New public APIs must be adopted deliberately rather than imported through unpublished internal paths.
