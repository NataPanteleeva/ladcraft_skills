# Host/cloud agent tools vs skill runtime capabilities

Этот документ нужен только когда вы разбираете поведение host/cloud агента, chat export, marketplace install, prompt-card workflow или делегирование. Для обычного кода навыка главным контрактом остаётся `handler(state, params)` и `state.capabilities`.

## Два разных слоя

### Skill runtime capabilities

Это APIs внутри `scripts/*.js`:

```javascript
async function handler(state, params) {
  const vfs = state.capabilities.vfs;
  const sqlStorage = state.capabilities['sql-storage'];
  const skills = state.capabilities.skills;
}
```

Авторинг:
- объявляются в `mcp_spec.tools[].capabilities.required` или tool meta;
- исполняются только внутри skill runtime;
- current surface сверяйте с `runtime-capabilities.snapshot.json`;
- не подменяются host-agent tools из чата.

### Host/cloud agent built-in tools

Это tools, доступные самому агенту в host/cloud workspace. Их не нужно и нельзя вызывать из `scripts/*.js` как runtime APIs.

Подтверждённые группы:
- `skills` — control plane активных навыков: `activate`, `deactivate`, `list_active`, `list_available`;
- `skillMarketplace` — discovery/install plane: `search`, `install`;
- `prompts` — prompt-card repository: `list`, `search`, `get`;
- `bash` — shell-like tool поверх VFS roots (`/workspace`, `/session`, `/user`, `/space`), не desktop shell;
- `sqlStorage` — host agent table tool: `create`, `getByAgent`, `describe`, `getTableData`, `runSQL`, `dump`, `delete`;
- `taskPlan`, `taskContext`, `requestApproval`, `requestUserInput`, `cancelAndReplaceTask`;
- `delegateToAgent`, `delegateToAgents`, `agents`, `agentFriends`;
- `scheduler`;
- `user_memory`, `agent_memory`;
- `web_search`, `web_fetch`.

## Правила для агента

- Не пишите в `scripts/*.js` вызовы host/cloud built-in tools (`skillMarketplace`, `prompts`, `delegateToAgent`, `scheduler`, host `sqlStorage`, host `bash`).
- Если код навыка должен работать с файлами, таблицами, навыками или user info, используйте `state.capabilities.*` и объявляйте capability в payload.
- Не путайте:
  - skill runtime capability `skills` (`list/get/update/create/install` внутри handler);
  - host tool `skills` (`activate/deactivate/list_active/list_available` для управления active tools агента).
- Не путайте:
  - skill runtime capability `sql-storage` (`state.capabilities['sql-storage']`);
  - host tool `sqlStorage` (`action: getByAgent`, `dump`, etc.).
- Не переносите host `bash` assumptions в desktop Pi tools: desktop `sandboxed_shell`/fallback `bash` и cloud VFS-shaped `bash` имеют разные roots, permissions и lifecycle.

## Prompt-card bindings

В host/cloud agent service часть tools может быть скрыта до чтения нужного prompt card через `prompts(action="get", id=...)`.

Примеры workflow cards:
- `runtime-file-basics`;
- `vfs-runtime-file-access`;
- `structured-data-file-workflow`;
- `standalone-html-file-workflow`;
- `mermaid-diagram-workflow`;
- `scheduler-workflow`;
- `agent-delegation-workflow`;
- `sub-agent-handoff-workflow`;
- `tool-error-recovery`.

Это не локальное правило desktop Pi SDK. Если в текущей сессии tool `prompts` отсутствует, не выдумывайте его: следуйте локальным `.pi` docs и доступному tool list.

## Когда открывать этот appendix

- Анализ chat export показывает host tool name (`skillMarketplace`, `prompts`, `sqlStorage`, `delegateToAgent`, `scheduler`).
- Пользователь спрашивает про marketplace install, activation или prompt-card workflow.
- Нужно объяснить, почему tool из cloud agent недоступен в локальном desktop Pi session.
- Нужно отличить ошибку runtime capability в skill code от ошибки orchestration/control plane.
