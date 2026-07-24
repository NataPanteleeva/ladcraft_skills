# dev-server

Local skill workbench for Ladcraft-oriented workflow.

## Expected flow

1. In IDE (Cursor), read bundled `cursor_ladcraft/mcp_instructions.md` as the main operational router. Do not overwrite it with generic MCP instructions. If manual refresh is needed, use `GET /instructions/ladcraft?token=...`.
   Use `docs/ru/*` as the reference layer and `docs/ru/skill_templates/*` as approved examples and anti-patterns.
2. Open browser workbench and refresh local skill list (skills are read from folder structure).
3. Select skill, edit if needed, run script locally, then deploy/update directly to Ladcraft.
4. If remote calls return `401/403`, refresh token in UI (`Новый access token`) or reauthorize in Ladcraft and reuse fresh token.

## Skill folder format

Skills live in `cursor_ladcraft/skills/<skill-name>/`:

- Навык может быть **только инструкцией** (без папок `scripts/` и `widgets/`) — тогда в нём только `SKILL.md`. Такие навыки отображаются в workbench без возможности запуска скрипта; доступны редактирование и деплой.
- `SKILL.md` — frontmatter (name, description, optional `mcp_spec`) + body text
- `scripts/<name>.meta.md` — script metadata (`schemas` or `inputSchema`/`outputSchema`, resources, etc.) + `scripts/<name>.js` — canonical `async function handler(state, params)` code
- `widgets/<name>.MD` — frontmatter (name, description, schema, optional `scriptRefs: ['<name>.widget.js']`) + HTML template. Client-side JS виджета хранится в `scripts/<name>.widget.js`, виджет импортирует его через `scriptRefs`, без дублирования кода в .MD.

Если в папке попадается legacy script body или legacy naming, dev-server сначала создает backup/quarantine и нормализует навык в canonical handler format, и только затем использует его локально или для deploy.

## Commands

```bash
npm install
npm run typecheck
npm run verify
npm run audit:builder
npm run dev
```

- API: `http://localhost:4321`
- web-ui (Vite): `http://localhost:5174`
- `npm run verify` прогоняет typecheck, `web-ui` build, regression fixtures и изолированный smoke `dev-server` на временных `LOCAL_SKILLS_DIR`/`PROTOTYPE_SKILLS_DIR`.
- `npm run audit:builder` пишет corpus-аудит в `skills/.audit/builder-audit.{json,md}`.

## API endpoints

- `GET /api/health`
- `GET /api/local/skills`
- `GET /api/local/skills/:skillName`
- `POST /api/local/skills/upsert`
- `POST /api/local/execute`
- `GET /api/remote/skills`
- `POST /api/remote/deploy-local`
- `GET /api/system/update/status`
- `POST /api/system/update/start`
- `POST /api/system/update/rollback`

## Environment

See `.env.example`.
A generated `.env` file is added in downloaded archives.
Ladcraft access token is not persisted there; it lives only in dev-server runtime session.
