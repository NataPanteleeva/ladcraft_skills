# VFS → disk-ref migration plan

Goal: retire **opt-in VFS snapshot** (`doc-compare` profile) for compare agents and use **disk-ref** (`r7-disk:{document_id}`) everywhere, simplifying Block 1 in [`src/transfer/`](../src/transfer/).

## Why migrate

| VFS snapshot | disk-ref |
|--------------|----------|
| Upload latency before each send | No upload |
| Race: agent starts before file ready | Reference only |
| Requires VFS skills (`read_r7_snapshot_text`) | Requires R7 Disk API skills (`R7_DISK_*`) |
| Dual profile complexity in plugin | Default profile already |

## Prerequisites (per agent)

1. Document opened **from R7-Диск** (numeric `document_id` in URL).
2. Agent instruction uses disk START/COMPARE flow (not bash on `/session/r7/`).
3. Skills bound:
   - `r7-compare-disk` or equivalent disk toolkit
   - `r7_fetch_disk_document`, `r7_list_disk_templates`, etc.
4. `install.defaults.json` / env: `R7_DISK_*` credentials for skill runtime.
5. User disk folder **`templates`** with `.md` / `.docx` templates.

## Agent inventory (repo)

| Agent / case | Current profile | Target |
|--------------|-----------------|--------|
| `r7-compare-docs` agents (`DISK_REF_AGENT_IDS`) | disk-ref | keep |
| `compare-r7`, «Сравнение 27» (`VFS_SNAPSHOT_AGENT_IDS`) | VFS | **migrate** |
| `examples_sergey`, analytics | disk-ref | keep |

Prod agent IDs in [`src/config.ts`](../src/config.ts): `VFS_SNAPSHOT_AGENT_IDS`, `DISK_REF_AGENT_IDS`.

## Migration steps (one agent)

### Phase 1 — Skills & instruction

1. Publish disk skills from `cases/compare-r7/` or approved variant `r7-compare-toolkit` disk fork.
2. Bind disk skills; **unbind** VFS-only tools (`read_r7_snapshot_text`, doc-compare VFS paths).
3. Update agent instruction:
   - START: list templates via disk API (not `ls /workspace/Templates` only).
   - COMPARE: read document B via `r7-disk:{id}` from `mentioned.files`, template from disk `templates/`.
   - Remove references to `/session/r7/r7-*.json`.
4. Add skill output contract [`04-skill-output-contract.md`](04-skill-output-contract.md) hints (`r7.actions`, `r7.task`).

### Phase 2 — Plugin profile

1. Move agent ID from `VFS_SNAPSHOT_AGENT_IDS` → `DISK_REF_AGENT_IDS` in `config.ts`.
2. Or set per-user override: `localStorage` `ladcraft_r7_transfer_profile:{agentId}` = `"disk-ref"`.
3. Smoke in R7: open disk document → chat → compare → insert/download buttons.

### Phase 3 — Validation

| Check | Pass criteria |
|-------|---------------|
| No VFS upload on send | Network: no `POST .../vfs/upload` for document B |
| `mentioned.files` | `file_id` = `r7-disk:{id}` |
| Compare completes | Report markdown + optional CompareReport JSON |
| Buttons | Layer 1 `r7.actions`; layer 2 after «вставить»/«скачать» |
| Headless smoke | `lc_agent_drive.js run` with disk-ref payload fixture |

### Phase 4 — Cleanup

1. Remove agent from `VFS_SNAPSHOT_AGENT_IDS`.
2. Remove title heuristics (`compare-r7`, «Сравнение 27») forcing `doc-compare` in `resolveTransferProfile`.
3. After **all** agents migrated: consider making `disk-ref` the only profile and deleting VFS upload path (major version bump).

## Rollback

```javascript
localStorage.setItem("ladcraft_r7_transfer_profile:<agentId>", "doc-compare");
location.reload();
```

Re-bind VFS skills on the agent if disk path fails.

## Timeline suggestion

| Week | Action |
|------|--------|
| 1 | Migrate one staging «Сравнение 27» clone; parallel run disk + VFS |
| 2 | Prod cutover for `ju4MekTiV4psav71nudMI` with rollback override |
| 3 | Legacy `s_eDSWr8EkRPfDsbgBJxa` decommission or migrate |
| 4 | Remove VFS default fallback in `resolveTransferProfile` (optional) |

## Risks

| Risk | Mitigation |
|------|------------|
| Document not on disk | UI error from `disk-ref.ts`; user must open from R7-Диск |
| Missing `templates` folder | Skill error message; document in INSTALL.md |
| Mixed agent skills (VFS + disk) | Never bind both; checklist in Phase 1 |
| Long compare without disk id | disk-ref impossible — keep VFS only for local-file edge case until R7 API supports export ref |

## References

- [01-transfer-rules.md](01-transfer-rules.md) — disk-ref vs VFS
- [`cases/compare-r7/docs/approved-r7-document-compare.md`](../../../compare-r7/docs/approved-r7-document-compare.md)
- [`knowledge-base/plugins/curated/ladcraft-r7-plugin-input-requirements.md`](../../../knowledge-base/plugins/curated/ladcraft-r7-plugin-input-requirements.md)
