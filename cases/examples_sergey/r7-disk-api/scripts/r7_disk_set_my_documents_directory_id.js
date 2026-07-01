/**
 * Сохраняет id корня «Мои документы» в skillStorage для повторных запусков агента.
 * @param {Record<string, unknown>} state
 * @param {{ directory_id?: unknown, directory_name?: unknown, force_repeat?: unknown }} params
 */
async function handler(state, params) {
	const skillStorage = resolveSkillStorage(state);
	if (!skillStorage) {
		return {
			ok: false,
			error:
				'KV storage недоступен. Переопубликуйте навык с capability key-value-storage (default_capabilities в SKILL.md).'
		};
	}

	const directoryId = parsePositiveId(params?.directory_id);
	if (directoryId == null) {
		return { ok: false, error: 'Укажите directory_id — положительное целое число.' };
	}

	const cachedRootRaw = skillStorage.get('r7_disk_my_documents_directory_id');
	const cachedRoot = parsePositiveId(cachedRootRaw);
	if (cachedRoot === directoryId && params.force_repeat !== true) {
		const directoryNameCached =
			typeof params?.directory_name === 'string' && params.directory_name.trim()
				? params.directory_name.trim()
				: 'Мои документы';
		return withFactualCitation(
			{
				ok: true,
				my_documents_directory_id: directoryId,
				directory_name: directoryNameCached,
				persisted: true,
				already_completed: true,
				do_not_retry: true,
				forbid_followup_tools: ['r7_disk_set_my_documents_directory_id', 'r7_disk_login'],
				agent_message:
					`Корень «${directoryNameCached}» (id=${directoryId}) уже сохранён в skillStorage. Повторный вызов не нужен.`
			},
			['my_documents_directory_id', 'directory_name', 'agent_message']
		);
	}

	const directoryName =
		typeof params?.directory_name === 'string' && params.directory_name.trim()
			? params.directory_name.trim()
			: 'Мои документы';

	skillStorage.set('r7_disk_my_documents_directory_id', String(directoryId));
	skillStorage.set(
		'r7_disk_section_roots',
		JSON.stringify({ docs: directoryId })
	);
	skillStorage.set('r7_disk_storage_state', 'personal_with_content');
	skillStorage.set('r7_disk_create_target', '');
	skillStorage.set('r7_disk_accessible_roots', '');

	return withFactualCitation(
		{
			ok: true,
			my_documents_directory_id: directoryId,
			directory_name: directoryName,
			persisted: true,
			do_not_retry: true,
			forbid_followup_tools: ['r7_disk_set_my_documents_directory_id', 'r7_disk_login'],
			agent_message:
				`Корень «${directoryName}» (id=${directoryId}) сохранён в skillStorage. ` +
				'Следующие вызовы list_directory/browse/folder без parent_directory_id используют этот id.'
		},
		['my_documents_directory_id', 'directory_name', 'agent_message']
	);
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function parsePositiveId(value) {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
		return Math.trunc(value);
	}
	if (typeof value === 'string' && value.trim()) {
		const n = Number(value.trim());
		if (Number.isFinite(n) && n > 0) return Math.trunc(n);
	}
	return null;
}

/**
 * @typedef {Object} SkillKeyValueStorage
 * @property {(key: string) => unknown} get
 * @property {(key: string, value: string) => void} set
 */

/**
 * @param {Record<string, unknown>} state
 * @returns {SkillKeyValueStorage | null}
 */
function resolveSkillStorage(state) {
	const caps = state.capabilities;
	if (!caps || typeof caps !== 'object') return null;
	const record = /** @type {Record<string, unknown>} */ (caps);
	const raw = record.skillStorage ?? record.storage ?? record['key-value-storage'];
	if (!raw || typeof raw !== 'object') return null;
	const kv = /** @type {{ get?: unknown; set?: unknown }} */ (raw);
	if (typeof kv.get !== 'function' || typeof kv.set !== 'function') return null;
	return /** @type {SkillKeyValueStorage} */ (raw);
}

/**
 * Подсказка агенту: не выдумывать данные вне полей ответа tool.
 * @template T
 * @param {T} fields
 * @param {string[]} citeOnlyFields
 * @returns {T}
 */
function withFactualCitation(fields, citeOnlyFields) {
	const record = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (fields));
	const msg = typeof record.agent_message === 'string' ? record.agent_message : '';
	const hint = ` Цитируй только ${citeOnlyFields.join(', ')} — не выдумывай.`;
	return /** @type {T} */ ({
		...fields,
		do_not_invent_content: true,
		cite_only_fields: citeOnlyFields,
		agent_message: msg.includes('не выдумывай') ? msg : msg + hint
	});
}