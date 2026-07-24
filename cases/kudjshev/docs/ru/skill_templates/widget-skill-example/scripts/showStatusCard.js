async function handler(state, params) {
	/*__CURSOR_LADCRAFT_WIDGET_NAME__=statusCard*/
	const title = typeof params?.title === 'string' ? params.title.trim() : '';
	const message = typeof params?.message === 'string' ? params.message.trim() : '';

	if (!title || !message) {
		return {
			title: '',
			message: 'title и message обязательны',
			docsUrl: 'https://example.com/docs'
		};
	}

	return {
		title,
		message,
		docsUrl: 'https://example.com/docs'
	};
}
