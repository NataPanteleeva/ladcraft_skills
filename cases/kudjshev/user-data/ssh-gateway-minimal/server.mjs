import express from 'express';
import { Client } from 'ssh2';

const app = express();
app.use(express.json({ limit: '1mb' }));

const token = process.env.GATEWAY_TOKEN?.trim();
if (!token) {
	console.error('Задайте GATEWAY_TOKEN');
	process.exit(1);
}

function auth(req, res, next) {
	const header = req.headers.authorization ?? '';
	const match = /^Bearer\s+(.+)$/i.exec(header);
	if (!match || match[1] !== token) {
		res.status(401).json({ ok: false, error: 'Unauthorized' });
		return;
	}
	next();
}

app.get('/health', auth, (_req, res) => {
	res.json({ ok: true });
});

app.post('/v1/exec', auth, (req, res) => {
	const { host, port = 22, username, command, timeoutSeconds = 60, auth: sshAuth } = req.body ?? {};

	if (!host || !username || !command) {
		res.status(400).json({ ok: false, error: 'host, username и command обязательны' });
		return;
	}

	const conn = new Client();
	const timeoutMs = Math.min(300, Math.max(1, Number(timeoutSeconds) || 60)) * 1000;
	let settled = false;

	const finish = (payload, status = 200) => {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
		try {
			conn.end();
		} catch {
			/* ignore */
		}
		res.status(status).json(payload);
	};

	const timer = setTimeout(() => {
		finish({ ok: false, error: 'SSH exec timeout' }, 504);
	}, timeoutMs);

	const connectConfig = {
		host,
		port: Number(port) || 22,
		username,
		readyTimeout: 15000
	};

	if (sshAuth?.type === 'private_key' && sshAuth.privateKey) {
		connectConfig.privateKey = String(sshAuth.privateKey);
	} else if (sshAuth?.type === 'password' && sshAuth.password) {
		connectConfig.password = String(sshAuth.password);
	} else {
		finish({ ok: false, error: 'auth.type private_key или password обязателен' }, 400);
		return;
	}

	conn
		.on('ready', () => {
			conn.exec(String(command), (err, stream) => {
				if (err) {
					finish({ ok: false, error: err.message }, 500);
					return;
				}

				let stdout = '';
				let stderr = '';

				stream.on('close', (code) => {
					finish({
						ok: true,
						exitCode: typeof code === 'number' ? code : 0,
						stdout,
						stderr
					});
				});

				stream.on('data', (chunk) => {
					stdout += chunk.toString();
				});
				stream.stderr.on('data', (chunk) => {
					stderr += chunk.toString();
				});
			});
		})
		.on('error', (err) => {
			finish({ ok: false, error: err.message }, 500);
		})
		.connect(connectConfig);
});

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => {
	console.log(`SSH Gateway listening on http://127.0.0.1:${port}`);
});
