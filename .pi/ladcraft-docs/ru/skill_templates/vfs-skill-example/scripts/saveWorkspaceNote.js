async function handler(state, params) {
	const filePath = typeof params?.path === 'string' ? params.path.trim() : '';
	const content = typeof params?.content === 'string' ? params.content : '';
	const rawVfs = state.capabilities?.vfs;
	const canWrite =
		rawVfs &&
		typeof rawVfs === 'object' &&
		typeof rawVfs.writeFile === 'function';

	if (!filePath || !canWrite) {
		return { ok: false, savedPath: '' };
	}

	await rawVfs.writeFile(filePath, content);

	return { ok: true, savedPath: filePath };
}
