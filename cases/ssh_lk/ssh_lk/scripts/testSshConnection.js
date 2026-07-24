async function handler(state, params) {
	const target = resolveSshTarget(state);
	if (!target.ok) {
		return { ok: false, error: target.error };
	}

	const auth = resolveSshAuth(state);
	if (!auth.ok) {
		return { ok: false, error: auth.error, host: target.host };
	}

	const command = 'whoami && (hostname -f 2>/dev/null || hostname)';
	const sshResult = await execSsh(state, {
		host: target.host,
		port: target.port,
		username: target.username,
		command,
		password: auth.password,
		privateKey: auth.privateKey,
		timeoutSeconds: 30
	});

	if (!sshResult.ok) {
		return {
			ok: false,
			error: sshResult.error || 'SSH-подключение не удалось',
			host: target.host,
			username: target.username,
			stdout: sshResult.stdout || '',
			stderr: sshResult.stderr || ''
		};
	}

	if (typeof sshResult.exitCode === 'number' && sshResult.exitCode !== 0) {
		return {
			ok: false,
			error: 'Проверочная команда завершилась с ошибкой',
			host: target.host,
			username: target.username,
			exitCode: sshResult.exitCode,
			stdout: sshResult.stdout || '',
			stderr: sshResult.stderr || ''
		};
	}

	return {
		ok: true,
		message: 'Подключение к серверу успешно',
		host: target.host,
		port: target.port,
		username: target.username,
		stdout: (sshResult.stdout || '').trim()
	};
}
