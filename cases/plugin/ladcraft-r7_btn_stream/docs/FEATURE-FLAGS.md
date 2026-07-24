# Feature flags — unified Ladcraft R7 plugin

`ladcraft-r7_btn_stream` is the **canonical** plugin tree. Former forks (`ladcraft-r7`, `ladcraft-r7_btn`, `side/ladcraft-r7`) map to build-time variants and runtime overrides instead of separate codebases.

## Variants

| Variant | `sseStreaming` | `actionButtons` | `panelLayout` | Former fork |
|---------|----------------|-----------------|---------------|-------------|
| `base` | off | off | default | `ladcraft-r7` |
| `btn` | off | on | default | `ladcraft-r7_btn` |
| `btn_stream` | on | on | default | `ladcraft-r7_btn_stream` (default) |
| `side` | off | off | side | `side/ladcraft-r7` |

## Build

Default build = `btn_stream`:

```bash
npm run build
```

Variant builds (esbuild `--define`):

```bash
npm run build:base
npm run build:btn
npm run build:btn-stream
npm run build:side
```

Output is always `dist/app.js`. Install the built folder into R7 Office as usual.

## Runtime overrides

Persisted in `localStorage` key `ladcraft_r7_features`:

```json
{
  "sseStreaming": true,
  "actionButtons": true,
  "panelLayout": "default"
}
```

Legacy SSE toggle `ladcraft_r7_sse_enabled` (`"0"` / `"1"`) is still read and merged into `sseStreaming`.

From browser devtools console inside the plugin:

```javascript
// disable streaming, keep buttons
localStorage.setItem("ladcraft_r7_features", JSON.stringify({ sseStreaming: false }));
location.reload();
```

## Code map

| Concern | Module |
|---------|--------|
| Variant presets | [`src/features.ts`](../src/features.ts), [`src/variant.ts`](../src/variant.ts) |
| Chat transport | [`src/eai/transport.ts`](../src/eai/transport.ts) |
| SSE implementation | [`src/eai/sse-hybrid-transport.ts`](../src/eai/sse-hybrid-transport.ts) |
| Poll-only stub | [`src/eai/poll-only-transport.ts`](../src/eai/poll-only-transport.ts) |
| AG-UI placeholder | [`src/eai/ag-ui-transport.ts`](../src/eai/ag-ui-transport.ts) |
| Stream UI orchestration | [`src/eai/stream-orchestrator.ts`](../src/eai/stream-orchestrator.ts) |
| Action buttons gate | [`src/ui/chat-history.ts`](../src/ui/chat-history.ts) `actionButtons` option |

## Consolidation status

- **Done:** single tree with flags replaces separate SSE/button forks for new work.
- **Legacy folders** (`cases/plugin/ladcraft-r7`, `ladcraft-r7_btn`, `side/ladcraft-r7`) remain as reference snapshots until removed in a follow-up PR.
- **Recommended:** build `btn_stream` for production; use `build:btn` if SSE is unstable on a tenant.

## VFS migration

See [VFS-TO-DISK-REF-MIGRATION.md](VFS-TO-DISK-REF-MIGRATION.md) for moving legacy compare agents off session VFS.
