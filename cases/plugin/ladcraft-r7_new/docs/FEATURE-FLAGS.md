# Feature flags

| Variant | `sseStreaming` | `panelLayout` | Notes |
|---------|----------------|---------------|-------|
| `base` | false | default | |
| `btn` | false | default | |
| `btn_stream` | **true** | default | default LCA build |
| `side` | false | side | |

`actionButtons` **удалён** — legacy compare insert/download UI removed. Apply только через intent-фразы.

Overrides: `localStorage` key `ladcraft_r7_features` (`sseStreaming`, `panelLayout`).
