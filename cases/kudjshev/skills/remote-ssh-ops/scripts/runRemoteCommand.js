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

	const timeoutSeconds = clampTimeout(params?.timeoutSeconds);
	const sshResult = await execViaParamiko({
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

async function execViaParamiko(config) {
	const sshApi = globalThis.paramikoSsh;
	if (!sshApi || typeof sshApi.exec !== 'function') {
		return {
			ok: false,
			error:
				'paramikoSsh недоступен в runtime. Локально: pip install paramiko и dev-server с поддержкой paramiko.'
		};
	}
	return sshApi.exec(config);
}

function clampTimeout(value) {
	const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 60;
	return Math.min(300, Math.max(1, n));
}

function resolveSshTarget(state) {
	const userEnv = state.environment?.user ?? {};

	const host = typeof userEnv.SSH_HOST === 'string' ? userEnv.SSH_HOST.trim() : '';
	if (!host) {
		return { ok: false, error: 'Укажите IP-адрес сервера (SSH_HOST) при установке навыка' };
	}

	const username = typeof userEnv.SSH_USER === 'string' ? userEnv.SSH_USER.trim() : '';
	if (!username) {
		return { ok: false, error: 'Укажите имя пользователя (SSH_USER) при установке навыка' };
	}

	let port = 22;
	if (typeof userEnv.SSH_PORT === 'string' && userEnv.SSH_PORT.trim()) {
		const parsed = Number.parseInt(userEnv.SSH_PORT.trim(), 10);
		if (Number.isFinite(parsed) && parsed > 0 && parsed <= 65535) {
			port = parsed;
		}
	}

	return { ok: true, host, port, username };
}

function resolveSshAuth(state) {
	const userEnv = state.environment?.user ?? {};
	const privateKey =
		typeof userEnv.SSH_PRIVATE_KEY === 'string' ? normalizePrivateKey(userEnv.SSH_PRIVATE_KEY) : '';
	const password =
		typeof userEnv.SSH_PASSWORD === 'string' && userEnv.SSH_PASSWORD.length > 0
			? userEnv.SSH_PASSWORD
			: '';

	if (privateKey) {
		return { ok: true, privateKey, password: '' };
	}

	if (password) {
		return { ok: true, privateKey: '', password };
	}

	return {
		ok: false,
		error: 'Укажите пароль (SSH_PASSWORD) или приватный ключ (SSH_PRIVATE_KEY) при установке навыка'
	};
}

function normalizePrivateKey(raw) {
	const trimmed = raw.trim();
	if (!trimmed) {
		return '';
	}
	if (trimmed.includes('\\n')) {
		return trimmed.replace(/\\n/g, '\n');
	}
	return trimmed;
}