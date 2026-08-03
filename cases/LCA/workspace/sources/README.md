# LORuGEC sources (LCA)

- Raw dataset: `cases/LORuGEC-main/` (see `ATTRIBUTION.md` there).
- Runtime agent reads only `/workspace/methodology/proofread_core_rules.md`.
- `extract_lorugec_core.js` — optional one-shot helper for maintainers; not part of skill flow.
- `sync_proofread_payload.js` — sync `payloads/lca-proofread.api.json` from SKILL.md.
- `smoke_proofread_core.js` — static wiring check for Core proofread.
