async function handler(state, params) {
	const message =
		typeof params?.message === 'string' && params.message.trim() ? params.message.trim() : '';

	if (!message) {
		return { ok: false, message: 'message обязателен' };
	}

	return { ok: true, message };
}
