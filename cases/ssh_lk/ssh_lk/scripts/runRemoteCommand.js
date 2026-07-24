async function handler(state, params) {
	const command =
		typeof params?.command === 'string' && params.command.trim() ? params.command.trim() : '';

	if (!command) {
		return { ok: false, error: 'command обязателен' };
	}

	const target = resolveSshTarget(state);
	if (!target.ok) {
		return { ok: false, error: target.error, command };
	}

	const auth = resolveSshAuth(state);
	if (!auth.ok) {
		return { ok: false, error: auth.error, command, host: target.host };
	}

	const timeoutSeconds = clampTimeout(params?.timeoutSeconds, 60);
	const sshResult = await execSsh(state, {
		host: target.host,
		port: target.port,
		username: target.username,
		command,
		password: auth.password,
		privateKey: auth.privateKey,
		timeoutSeconds
	});

	if (!sshResult.ok) {
		return {
			ok: false,
			error: sshResult.error || 'SSH-команда не выполнена',
			host: target.host,
			command,
			stdout: sshResult.stdout || '',
			stderr: sshResult.stderr || ''
		};
	}

	return {
		ok: true,
		exitCode: typeof sshResult.exitCode === 'number' ? sshResult.exitCode : 0,
		stdout: sshResult.stdout || '',
		stderr: sshResult.stderr || '',
		host: target.host,
		command
	};
}
