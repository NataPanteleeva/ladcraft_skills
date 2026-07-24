async function handler(state, params) {
	const userEnv = state.environment?.user ?? {};
	const prefix =
		typeof userEnv.GREETING_PREFIX === 'string' && userEnv.GREETING_PREFIX.trim()
			? userEnv.GREETING_PREFIX.trim()
			: 'Hello';

	const name =
		typeof params?.name === 'string' && params.name.trim() ? params.name.trim() : 'world';

	return {
		ok: true,
		greeting: `${prefix}, ${name}!`
	};
}
