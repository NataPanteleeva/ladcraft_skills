#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

function getArg(flag, required = false) {
	const idx = process.argv.indexOf(flag);
	if (idx < 0 || idx + 1 >= process.argv.length) {
		if (required) {
			throw new Error(`Missing required argument: ${flag}`);
		}
		return '';
	}
	return String(process.argv[idx + 1] ?? '');
}

const mode = getArg('--mode', true);
const workspaceRoot = getArg('--workspace-root', true);
const statusFile = getArg('--status-file', true);
const backupMetaFile = getArg('--backup-meta-file', true);
const runId = getArg('--run-id', true);
getArg('--server-pid', false);
const prototypeBaseUrl = getArg('--prototype-base-url', false);
const backupPathArg = getArg('--backup-path', false);
const currentVersion = getArg('--current-version', false) || null;
const targetVersion = getArg('--target-version', false) || null;
const prototypeToken = String(process.env.CURSOR_LADCRAFT_PROTOTYPE_TOKEN ?? '').trim();

const updateTmpDir = join(workspaceRoot, '.update-tmp');
const updateBackupsDir = join(workspaceRoot, '.update-backups');

const preserveTopLevel = new Set(['skills', 'user-data', '.git', '.update-tmp', '.update-backups']);
const preserveRelativePaths = new Set(['dev-server/node_modules', 'dev-server/web-ui/node_modules']);
const backupExcludeTopLevel = new Set([
	'skills',
	'user-data',
	'.update-tmp',
	'.update-backups',
	'dev-server/node_modules',
	'dev-server/web-ui/node_modules',
	'.git'
]);

async function ensureParent(filePath) {
	await mkdir(dirname(filePath), { recursive: true });
}

async function readStatus() {
	try {
		if (!existsSync(statusFile)) return null;
		const raw = await readFile(statusFile, 'utf-8');
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? parsed : null;
	} catch {
		return null;
	}
}

async function writeStatusPatch(patch) {
	const prev = (await readStatus()) ?? {};
	const next = {
		...prev,
		...patch,
		preserveSkills: true,
		runId,
		updatedAt: new Date().toISOString()
	};
	await ensureParent(statusFile);
	await writeFile(statusFile, JSON.stringify(next, null, 2), 'utf-8');
}

function startsWithSegment(relPath, segment) {
	return relPath === segment || relPath.startsWith(`${segment}/`);
}

function normalizeRel(relPath) {
	return relPath.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function shouldSkipBackup(relPath) {
	const normalized = normalizeRel(relPath);
	for (const rule of backupExcludeTopLevel) {
		if (startsWithSegment(normalized, rule)) return true;
	}
	return false;
}

function shouldPreserveExistingTopLevel(name) {
	return preserveTopLevel.has(name);
}

/**
 * Удаляет дочерние элементы каталога, оставляя перечисленные имена на этом уровне.
 * Сам `dirPath` не удаляется (удобно для `dev-server/web-ui`: не трогаем `node_modules`).
 */
async function pruneDirectoryEntries(dirPath, keepNames) {
	if (!existsSync(dirPath)) return;
	const entries = await readdir(dirPath, { withFileTypes: true });
	for (const e of entries) {
		if (keepNames.has(e.name)) continue;
		await rm(join(dirPath, e.name), { recursive: true, force: true });
	}
}

async function copyDirContents(sourceDir, targetDir, shouldSkipRel) {
	await mkdir(targetDir, { recursive: true });
	const entries = await readdir(sourceDir, { withFileTypes: true });
	for (const entry of entries) {
		const rel = entry.name;
		if (shouldSkipRel(rel)) continue;
		const srcPath = join(sourceDir, entry.name);
		const dstPath = join(targetDir, entry.name);
		if (entry.isDirectory()) {
			await cp(srcPath, dstPath, {
				recursive: true,
				filter: (from) => {
					const relFromSource = normalizeRel(from.slice(sourceDir.length + 1));
					return !shouldSkipRel(relFromSource);
				}
			});
		} else {
			await cp(srcPath, dstPath, { recursive: false });
		}
	}
}

async function clearWorkspacePreservingDrafts() {
	const topLevelEntries = await readdir(workspaceRoot, { withFileTypes: true });
	for (const entry of topLevelEntries) {
		if (shouldPreserveExistingTopLevel(entry.name)) continue;
		const entryPath = join(workspaceRoot, entry.name);
		if (!entry.isDirectory()) {
			await rm(entryPath, { force: true });
			continue;
		}
		if (entry.name === 'dev-server') {
			const devServerEntries = await readdir(entryPath, { withFileTypes: true });
			for (const devEntry of devServerEntries) {
				const rel = normalizeRel(`dev-server/${devEntry.name}`);
				if (preserveRelativePaths.has(rel)) continue;
				const childPath = join(entryPath, devEntry.name);
				// Нельзя rm всю web-ui: сохраняем web-ui/node_modules (см. preserveRelativePaths).
				// Иначе возможен ENOTEMPTY / обрыв при удалении большого дерева.
				if (devEntry.isDirectory() && devEntry.name === 'web-ui') {
					await pruneDirectoryEntries(childPath, new Set(['node_modules']));
					continue;
				}
				await rm(childPath, { recursive: true, force: true });
			}
			continue;
		}
		await rm(entryPath, { recursive: true, force: true });
	}
}

async function detectExtractedBundleRoot(extractDir) {
	const entries = await readdir(extractDir, { withFileTypes: true });
	if (entries.length === 1 && entries[0].isDirectory()) {
		return join(extractDir, entries[0].name);
	}
	return extractDir;
}

async function triggerWatcherReload() {
	// В dev-режиме tsx/vite подхватят изменения по mtime без ручного reopen проекта.
	for (const relPath of ['dev-server/src/server.ts', 'dev-server/web-ui/src/App.svelte']) {
		const filePath = join(workspaceRoot, relPath);
		try {
			const fileStat = await stat(filePath);
			const now = new Date();
			await utimes(filePath, now, now);
			if (!Number.isFinite(fileStat.mtimeMs)) {
				// noop; важно лишь обновить timestamp
			}
		} catch {
			// ignore
		}
	}
}

async function saveBackupMeta(backupPath) {
	const payload = { backupPath, createdAt: new Date().toISOString() };
	await ensureParent(backupMetaFile);
	await writeFile(backupMetaFile, JSON.stringify(payload, null, 2), 'utf-8');
}

async function doUpdate() {
	if (!prototypeBaseUrl.trim()) {
		throw new Error('prototype base url is required for update mode');
	}
	if (!prototypeToken) {
		throw new Error('prototype token is required for update mode');
	}

	const runTmpDir = join(updateTmpDir, runId);
	const archivePath = join(runTmpDir, 'cursor_ladcraft.zip');
	const extractDir = join(runTmpDir, 'extract');
	const backupPath = join(updateBackupsDir, `${Date.now()}-${runId}`);
	await rm(runTmpDir, { recursive: true, force: true });
	await mkdir(runTmpDir, { recursive: true });

	await writeStatusPatch({
		state: 'running',
		mode: 'update',
		stage: 'downloading',
		message: 'Скачиваем свежий архив cursor_ladcraft...',
		startedAt: new Date().toISOString(),
		finishedAt: null,
		currentVersion,
		targetVersion,
		lastError: null
	});

	const endpoint = `${prototypeBaseUrl.replace(/\/$/, '')}/api/skills-builder-ladcraft/download-config`;
	const response = await fetch(endpoint, {
		method: 'GET',
		headers: { Authorization: `Bearer ${prototypeToken}` }
	});
	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(`download failed (${response.status}): ${body || response.statusText}`);
	}
	const archiveBuffer = Buffer.from(await response.arrayBuffer());
	await writeFile(archivePath, archiveBuffer);

	await writeStatusPatch({
		state: 'running',
		mode: 'update',
		stage: 'unpacking',
		message: 'Распаковываем архив обновления...'
	});

	await mkdir(extractDir, { recursive: true });
	const unzip = spawnSync('unzip', ['-q', archivePath, '-d', extractDir], {
		encoding: 'utf-8'
	});
	if (unzip.status !== 0) {
		throw new Error(unzip.stderr?.trim() || unzip.stdout?.trim() || 'unzip failed');
	}
	const extractedBundleRoot = await detectExtractedBundleRoot(extractDir);

	await writeStatusPatch({
		state: 'running',
		mode: 'update',
		stage: 'backing_up',
		message: 'Создаем backup текущего bundle (без skills)...'
	});

	await mkdir(backupPath, { recursive: true });
	await copyDirContents(workspaceRoot, backupPath, shouldSkipBackup);
	await saveBackupMeta(backupPath);

	await writeStatusPatch({
		state: 'running',
		mode: 'update',
		stage: 'applying',
		message: 'Применяем обновление (локальная папка skills сохраняется)...',
		backupPath
	});

	await clearWorkspacePreservingDrafts();
	await copyDirContents(extractedBundleRoot, workspaceRoot, (rel) => {
		const normalized = normalizeRel(rel);
		return startsWithSegment(normalized, 'skills');
	});

	await writeStatusPatch({
		state: 'running',
		mode: 'update',
		stage: 'restarting',
		message: 'Обновление применено, инициируем перезапуск/перечтение конфигурации...'
	});

	await triggerWatcherReload();

	await writeStatusPatch({
		state: 'success',
		mode: 'update',
		stage: 'completed',
		message: 'Обновление завершено. Локальные черновики в skills сохранены.',
		finishedAt: new Date().toISOString(),
		lastError: null
	});
}

async function doRollback() {
	const backupPath = backupPathArg.trim();
	if (!backupPath) {
		throw new Error('backup path is required for rollback mode');
	}
	const normalizedBackupPath = backupPath;
	if (!existsSync(normalizedBackupPath)) {
		throw new Error(`backup not found: ${normalizedBackupPath}`);
	}

	await writeStatusPatch({
		state: 'running',
		mode: 'rollback',
		stage: 'rollback_applying',
		message: 'Применяем rollback (локальная папка skills сохраняется)...',
		backupPath: normalizedBackupPath,
		finishedAt: null
	});

	await clearWorkspacePreservingDrafts();
	await copyDirContents(normalizedBackupPath, workspaceRoot, () => false);
	await triggerWatcherReload();

	await writeStatusPatch({
		state: 'success',
		mode: 'rollback',
		stage: 'rolled_back',
		message: `Rollback завершен из backup ${basename(normalizedBackupPath)}. Черновики skills сохранены.`,
		finishedAt: new Date().toISOString(),
		lastError: null
	});
}

async function main() {
	try {
		if (mode === 'update') {
			await doUpdate();
			return;
		}
		if (mode === 'rollback') {
			await doRollback();
			return;
		}
		throw new Error(`Unsupported mode: ${mode}`);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await writeStatusPatch({
			state: 'failed',
			stage: 'failed',
			message: 'Автообновление завершилось ошибкой',
			lastError: message,
			finishedAt: new Date().toISOString()
		});
		process.exitCode = 1;
	} finally {
		try {
			await rm(updateTmpDir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	}
}

await main();
