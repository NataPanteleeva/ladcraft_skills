import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { type LocalSkillPayload } from '../src/skill-folder-reader.js';
import {
	hasExistingSkillFolder,
	readLocalSkillEntryFromFolder
} from '../src/local-skill-registry.js';
import {
	buildLadcraftDeployDiagnostics,
	convertLocalSkillToLadcraftPayload,
	mergeCapabilitiesRequiredLists,
	resolveCapabilitiesRequiredForLocalScript,
	resolveMcpSpecDefaultCapabilitiesRequired
} from '../src/skill-builder.js';
import { readCanonicalSkillFromFolder, writeSkillToFolder } from '../src/skill-folder-writer.js';

const devServerRoot = new URL('..', import.meta.url).pathname;

function log(step: string): void {
	console.log(`\n[verify-builder] ${step}`);
}

function encodeSkillPath(skillName: string): string {
	return encodeURIComponent(skillName);
}

function samplePayloads(): LocalSkillPayload[] {
	return [
		{
			name: 'fixture_local_vfs_alias',
			description: 'Fixture for local VFS alias inference.',
			body: 'Fixture body',
			mcp_spec: {
				tools: [{ name: 'saveNote' }]
			},
			scripts: [
				{
					name: 'saveNote',
					description: 'Writes a note',
					input_schema: {
						type: 'object',
						properties: { content: { type: 'string' } },
						required: ['content'],
						additionalProperties: false
					},
					output_schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
					code: "await vfs.write('/workspace/notes/demo.md', input.content || 'demo');\nreturnResult({ ok: true });",
					auth: null,
					order: 2,
					resources: {
						cpu: 0.2,
						memory: 128,
						timeout: 15,
						network: { hosts: ['fonts.googleapis.com'] }
					}
				}
			],
			widgets: []
		},
		{
			name: 'fixture_runtime_vfs_local_style',
			description: 'Fixture for runtime VFS anti-pattern diagnostics.',
			body: 'Fixture body',
			mcp_spec: { tools: [{ name: 'legacyReader' }] },
			scripts: [
				{
					name: 'legacyReader',
					description: 'Reads using runtime methods',
					input_schema: { type: 'object', properties: {}, additionalProperties: false },
					output_schema: { type: 'object', properties: { content: { type: 'string' } } },
					code: "const content = await vfs.readFile('/workspace/legacy.txt');\nreturnResult({ content });",
					auth: null
				}
			],
			widgets: []
		},
		{
			name: 'fixture_widget_ejs',
			description: 'Fixture for EJS widget.',
			body: 'Fixture body',
			mcp_spec: { tools: [{ name: 'showHello' }] },
			scripts: [
				{
					name: 'showHello',
					description: 'Shows hello widget',
					input_schema: {
						type: 'object',
						properties: { title: { type: 'string' } },
						additionalProperties: false
					},
					output_schema: null,
					code: "returnResultInWidget('helloWidget', input);",
					auth: null
				}
			],
			widgets: [
				{
					name: 'helloWidget',
					description: 'EJS widget',
					schema: { type: 'object', properties: { title: { type: 'string' } } },
					template:
						'<div class="hello"><% if (title) { %><h1><%= title %></h1><% } else { %><p>empty</p><% } %></div>',
					scripts: [{ type: 'inline', content: 'window.__helloWidgetLoaded = true;' }],
					external_libraries: []
				}
			]
		},
		{
			name: 'fixture_widget_handlebars',
			description: 'Fixture for Handlebars anti-pattern diagnostics.',
			body: 'Fixture body',
			mcp_spec: { tools: [{ name: 'showList' }] },
			scripts: [
				{
					name: 'showList',
					description: 'Shows a widget with Handlebars',
					input_schema: {
						type: 'object',
						properties: { items: { type: 'array', items: { type: 'string' } } },
						additionalProperties: false
					},
					output_schema: null,
					code: "returnResultInWidget('hbWidget', input);",
					auth: null
				}
			],
			widgets: [
				{
					name: 'hbWidget',
					description: 'Handlebars widget',
					schema: { type: 'object', properties: {} },
					template:
						'<div>{{#if items.length}}<ul>{{#each items}}<li>{{this}}</li>{{/each}}</ul>{{else}}<p>empty</p>{{/if}}</div>',
					scripts: [],
					external_libraries: []
				}
			]
		},
		{
			name: 'fixture_explicit_default_caps',
			description: 'Fixture for explicit default capabilities merge.',
			body: 'Fixture body',
			mcp_spec: {
				tools: [{ name: 'saveMerged' }],
				default_capabilities: {
					required: [{ type: 'vfs', scope: '$USER', operations: ['readFile'] }]
				}
			},
			scripts: [
				{
					name: 'saveMerged',
					description: 'Writes a file with defaults',
					input_schema: { type: 'object', properties: {}, additionalProperties: false },
					output_schema: null,
					code: "await vfs.write('/workspace/data/output.md', 'merged');\nreturnResult({ ok: true });",
					auth: null
				}
			],
			widgets: []
		}
	];
}

async function createFixtures(localSkillsDir: string): Promise<LocalSkillPayload[]> {
	const payloads = samplePayloads();
	for (const payload of payloads) {
		await writeSkillToFolder(join(localSkillsDir, payload.name), payload);
	}
	return payloads;
}

async function runRoundTripChecks(
	localSkillsDir: string,
	payloads: LocalSkillPayload[]
): Promise<void> {
	log('round-trip checks');
	let sawBackupedCanonicalization = false;
	for (const payload of payloads) {
		const folderPath = join(localSkillsDir, payload.name);
		const canonical = await readCanonicalSkillFromFolder(folderPath);
		assert.ok(
			canonical.payload.scripts.every((script) => script.code.includes('async function handler(')),
			`Expected canonical handler scripts for ${payload.name}`
		);
		assert.ok(
			canonical.payload.scripts.every(
				(script) =>
					!script.code.includes('returnResult(') &&
					!script.code.includes('returnResultInWidget(') &&
					!script.code.includes('const __result = await handler(')
			),
			`Did not expect legacy helper tail in canonical payload for ${payload.name}`
		);
		if (canonical.changed) {
			assert.ok(canonical.backupPath, `Expected backup path when canonicalizing ${payload.name}`);
			sawBackupedCanonicalization = true;
		}
		const secondRead = await readCanonicalSkillFromFolder(folderPath);
		assert.equal(secondRead.changed, false, `Expected stable canonical reread for ${payload.name}`);
		assert.equal(secondRead.backupPath, null, `Did not expect second backup for ${payload.name}`);
	}
	assert.ok(sawBackupedCanonicalization, 'Expected at least one fixture to require backuped canonicalization');
}

async function runPureBuilderChecks(): Promise<void> {
	log('pure builder regression checks');
	const writeCaps = resolveCapabilitiesRequiredForLocalScript(
		"await vfs.write('/workspace/demo.md', 'x');"
	);
	assert.deepEqual(writeCaps, [
		{ type: 'vfs', operations: ['writeFile', 'mkdir'], scope: '$USER' }
	]);

	const mixedCaps = resolveCapabilitiesRequiredForLocalScript(
		"await vfs.read('/workspace/a.md');\nawait vfs.list('/workspace');\nawait vfs.delete('/workspace/a.md');"
	);
	assert.deepEqual(mixedCaps, [
		{ type: 'vfs', operations: ['readFile', 'listDir', 'rm'], scope: '$USER' }
	]);

	const explicitCaps = resolveMcpSpecDefaultCapabilitiesRequired({
		default_capabilities: {
			required: [{ type: 'vfs', scope: '$USER', operations: ['readFile'] }]
		}
	});
	const merged = mergeCapabilitiesRequiredLists(writeCaps, explicitCaps);
	assert.deepEqual(merged, [
		{ type: 'vfs', operations: ['readFile', 'writeFile', 'mkdir'], scope: '$USER' }
	]);

	const diagnostics = buildLadcraftDeployDiagnostics(samplePayloads()[3]);
	assert.ok(
		diagnostics.widgets.some((item) =>
			item.warnings.some((warning) => warning.code === 'widget-handlebars-block-syntax')
		),
		'Expected Handlebars widget warning in diagnostics'
	);

	const converted = await convertLocalSkillToLadcraftPayload(samplePayloads()[4], {
		resolveDefaultCategory: async () => 'productivity'
	});
	const caps = (
		(converted.tools[0] as Record<string, unknown>).capabilities as { required?: unknown[] }
	).required as Array<Record<string, unknown>>;
	const functionSource = String((converted.tools[0] as Record<string, unknown>).function ?? '');
	assert.deepEqual(caps, [
		{
			type: 'vfs',
			operations: ['readFile', 'writeFile', 'mkdir'],
			scope: '$USER'
		}
	]);
	assert.ok(
		functionSource.includes('async function handler('),
		'Expected native handler in built tool payload'
	);
	assert.ok(
		!functionSource.includes('returnResult(') &&
			!functionSource.includes('returnResultInWidget(') &&
			!functionSource.includes('const __result = await handler('),
		'Did not expect local-style helpers or synthetic bootstrap in built tool payload'
	);
}

async function runSyncSafetyChecks(localSkillsDir: string): Promise<void> {
	log('sync safety regression checks');
	const malformedSkillName = 'fixture_manual_invalid_skill';
	const malformedFolder = join(localSkillsDir, malformedSkillName);
	await mkdir(malformedFolder, { recursive: true });
	const parsedEntry = await readLocalSkillEntryFromFolder(malformedFolder);
	assert.equal(parsedEntry, null, 'Expected malformed local skill entry to fail parsing');
	assert.equal(
		hasExistingSkillFolder(localSkillsDir, malformedSkillName),
		true,
		'Expected existing folder detection for malformed local skill'
	);
	await rm(malformedFolder, { recursive: true, force: true });
}

async function waitForServer(port: number, timeoutMs: number): Promise<void> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/api/local/skills`);
			if (response.ok) return;
		} catch {
			// retry
		}
		await delay(250);
	}
	throw new Error(`dev-server did not become ready on port ${port}`);
}

async function startServer(
	port: number,
	localSkillsDir: string,
	prototypeSkillsDir: string
): Promise<ChildProcess> {
	const child = spawn('npm', ['run', 'start', '--silent'], {
		cwd: devServerRoot,
		env: {
			...process.env,
			DEV_SERVER_PORT: String(port),
			LOCAL_SKILLS_DIR: localSkillsDir,
			PROTOTYPE_SKILLS_DIR: prototypeSkillsDir
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	child.stdout?.on('data', (chunk) => process.stdout.write(String(chunk)));
	child.stderr?.on('data', (chunk) => process.stderr.write(String(chunk)));
	await waitForServer(port, 20_000);
	return child;
}

async function stopServer(child: ChildProcess): Promise<void> {
	if (child.killed) return;
	child.kill('SIGTERM');
	await Promise.race([
		new Promise<void>((resolve) => child.once('exit', () => resolve())),
		delay(5_000).then(() => {
			if (!child.killed) child.kill('SIGKILL');
		})
	]);
}

async function fetchJson(path: string, port: number): Promise<unknown> {
	const response = await fetch(`http://127.0.0.1:${port}${path}`);
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`${path} -> ${response.status} ${text}`);
	}
	return text ? JSON.parse(text) : null;
}

async function runApiSmokeChecks(port: number): Promise<void> {
	log('dev-server API smoke checks');
	const list = (await fetchJson('/api/local/skills', port)) as { skills?: Array<{ name: string }> };
	assert.equal(list.skills?.length, 5, 'Expected fixture skills to be listed by dev-server');

	const legacySkill = 'fixture_runtime_vfs_local_style';
	const legacySkillResponse = (await fetchJson(
		`/api/local/skills/${encodeSkillPath(legacySkill)}`,
		port
	)) as {
		skill?: { scripts?: Array<{ code?: string }> };
	};
	const legacyCode = legacySkillResponse.skill?.scripts?.[0]?.code ?? '';
	assert.ok(
		legacyCode.includes('async function handler'),
		'Expected legacy local-style skill to be normalized into handler format'
	);
	assert.ok(
		!legacyCode.includes('returnResult(') &&
			!legacyCode.includes('returnResultInWidget(') &&
			!legacyCode.includes('const __result = await handler('),
		'Did not expect local-style helpers or synthetic bootstrap after normalization'
	);
	const legacyDetails = (await fetchJson(
		`/api/local/skills/${encodeSkillPath(legacySkill)}/ladcraft-deploy-check`,
		port
	)) as {
		diagnostics?: {
			scripts?: Array<{ warnings?: Array<{ code?: string }>; capabilitiesRequired?: unknown }>;
		};
	};
	const legacyWarnings = legacyDetails.diagnostics?.scripts?.[0]?.warnings ?? [];
	assert.ok(
		!legacyWarnings.some((warning) => warning.code === 'legacy-runtime-vfs-methods'),
		'Did not expect legacy runtime VFS warning after normalization'
	);

	const handlebarsSkill = 'fixture_widget_handlebars';
	const handlebarsDetails = (await fetchJson(
		`/api/local/skills/${encodeSkillPath(handlebarsSkill)}/ladcraft-deploy-check`,
		port
	)) as {
		diagnostics?: { widgets?: Array<{ warnings?: Array<{ code?: string }> }> };
	};
	assert.ok(
		handlebarsDetails.diagnostics?.widgets?.some((widget) =>
			(widget.warnings ?? []).some((warning) => warning.code === 'widget-handlebars-block-syntax')
		),
		'Expected Handlebars warning from dev-server diagnostics'
	);

	const explicitSkill = 'fixture_explicit_default_caps';
	const explicitPayload = (await fetchJson(
		`/api/local/skills/${encodeSkillPath(explicitSkill)}`,
		port
	)) as { skill?: { mcp_spec?: Record<string, unknown> } };
	assert.equal(
		typeof explicitPayload.skill?.mcp_spec?.default_capabilities,
		'object',
		'Expected explicit default_capabilities to survive local payload route'
	);

	const aliasExecutionRaw = await fetch(`http://127.0.0.1:${port}/api/local/execute`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			skillName: 'fixture_local_vfs_alias',
			scriptName: 'saveNote',
			input: { content: 'hello from verify' }
		})
	});
	assert.equal(aliasExecutionRaw.status, 200, 'Expected canonical local execute to succeed');
	const aliasExecution = (await aliasExecutionRaw.json()) as {
		ok?: boolean;
		result?: { ok?: boolean };
	};
	assert.equal(aliasExecution.ok, true, 'Expected successful /api/local/execute response');
	assert.equal(aliasExecution.result?.ok, true, 'Expected canonical handler result from /api/local/execute');

	const widgetExecutionRaw = await fetch(`http://127.0.0.1:${port}/api/local/execute`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			skillName: 'fixture_widget_ejs',
			scriptName: 'showHello',
			input: { title: 'Canonical Widget' }
		})
	});
	assert.equal(widgetExecutionRaw.status, 200, 'Expected widget local execute to succeed');
	const widgetExecution = (await widgetExecutionRaw.json()) as {
		ok?: boolean;
		result?: { title?: string };
		widget?: { name?: string; html?: string };
	};
	assert.equal(widgetExecution.ok, true, 'Expected successful widget execution response');
	assert.equal(widgetExecution.result?.title, 'Canonical Widget');
	assert.equal(widgetExecution.widget?.name, 'helloWidget');
	assert.ok(
		widgetExecution.widget?.html?.includes('<h1>Canonical Widget</h1>'),
		'Expected widget HTML to be rendered from canonical handler result'
	);
}

async function main(): Promise<void> {
	const tempRoot = await mkdtemp(join(tmpdir(), 'cursor-ladcraft-verify-'));
	const localSkillsDir = join(tempRoot, 'skills');
	const prototypeSkillsDir = join(tempRoot, 'skills_prototype');
	await mkdir(localSkillsDir, { recursive: true });
	await mkdir(prototypeSkillsDir, { recursive: true });

	let server: ChildProcess | null = null;
	try {
		const payloads = await createFixtures(localSkillsDir);
		await runRoundTripChecks(localSkillsDir, payloads);
		await runPureBuilderChecks();
		await runSyncSafetyChecks(localSkillsDir);
		const port = 43000 + Math.floor(Math.random() * 1000);
		server = await startServer(port, localSkillsDir, prototypeSkillsDir);
		await runApiSmokeChecks(port);
		log('all checks passed');
	} finally {
		if (server) await stopServer(server);
		await rm(tempRoot, { recursive: true, force: true });
	}
}

await main();
