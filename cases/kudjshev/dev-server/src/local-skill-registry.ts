import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat } from 'node:fs/promises';
import path, { join } from 'node:path';
import {
	getCanonicalChainStateKey,
	getLegacyNormalizedSkillName,
	getSkillIdentityKey,
	sanitizeSkillFolderName
} from './skill-identity.js';
import {
	getSkillFolderUpdatedAt,
	type LocalSkillPayload
} from './skill-folder-reader.js';
import { readCanonicalSkillFromFolder } from './skill-folder-writer.js';

export type LocalSkillEntry = {
	fileName: string;
	filePath: string;
	updatedAt: string;
	skill: LocalSkillPayload;
	isFromServer?: boolean;
	serverSkillId?: string;
	identityKey: string;
};

type ServerMeta = {
	isFromServer: boolean;
	serverSkillId?: string;
};

async function readServerMeta(folderPath: string): Promise<ServerMeta> {
	const metaPath = path.join(folderPath, '.from-server.json');
	if (!existsSync(metaPath)) {
		return { isFromServer: false };
	}
	try {
		const metaContent = await readFile(metaPath, 'utf-8');
		const meta = JSON.parse(metaContent) as { skillId?: string | number };
		const skillId =
			typeof meta.skillId === 'string'
				? meta.skillId.trim()
				: typeof meta.skillId === 'number'
					? String(meta.skillId)
					: '';
		return {
			isFromServer: true,
			serverSkillId: skillId || undefined
		};
	} catch {
		return { isFromServer: false };
	}
}

function getPreferredEntry(left: LocalSkillEntry, right: LocalSkillEntry): LocalSkillEntry {
	const leftCanonical = sanitizeSkillFolderName(left.skill.name);
	const leftLegacy = getLegacyNormalizedSkillName(left.skill.name);
	const rightCanonical = sanitizeSkillFolderName(right.skill.name);
	const rightLegacy = getLegacyNormalizedSkillName(right.skill.name);

	const score = (entry: LocalSkillEntry, canonical: string, legacy: string): number => {
		let value = 0;
		if (entry.fileName === canonical) value += 100;
		if (entry.fileName === legacy && legacy !== canonical) value -= 10;
		if (typeof entry.serverSkillId === 'string' && entry.serverSkillId.trim().length > 0) value += 20;
		return value;
	};

	const leftScore = score(left, leftCanonical, leftLegacy);
	const rightScore = score(right, rightCanonical, rightLegacy);
	if (leftScore !== rightScore) {
		return leftScore > rightScore ? left : right;
	}
	return left.updatedAt >= right.updatedAt ? left : right;
}

/**
 * Reads one local skill folder together with dev-server metadata.
 */
export async function readLocalSkillEntryFromFolder(folderPath: string): Promise<LocalSkillEntry | null> {
	try {
		const [skill, updatedAt, meta] = await Promise.all([
			readCanonicalSkillFromFolder(folderPath).then((result) => result.payload),
			getSkillFolderUpdatedAt(folderPath),
			readServerMeta(folderPath)
		]);
		const fileName = path.basename(folderPath);
		return {
			fileName,
			filePath: folderPath,
			updatedAt,
			skill,
			isFromServer: meta.isFromServer,
			serverSkillId: meta.serverSkillId,
			identityKey: getSkillIdentityKey({
				name: skill.name,
				serverSkillId: meta.serverSkillId
			})
		};
	} catch {
		return null;
	}
}

/**
 * Reads active local skills and suppresses duplicate visible entries for the same logical skill name.
 */
export async function listLocalSkillEntries(localSkillsDir: string): Promise<LocalSkillEntry[]> {
	let entries: string[];
	try {
		entries = await readdir(localSkillsDir);
	} catch {
		return [];
	}

	const rawEntries: LocalSkillEntry[] = [];
	for (const name of entries) {
		if (
			name === '.remote-cache' ||
			name === '.run-chain' ||
			name === '.legacy-conflicts' ||
			name === '.skill-backups'
		) continue;
		const folderPath = path.join(localSkillsDir, name);
		const statResult = await stat(folderPath).catch(() => null);
		if (!statResult?.isDirectory()) continue;
		const entry = await readLocalSkillEntryFromFolder(folderPath);
		if (entry) {
			rawEntries.push(entry);
		}
	}

	const deduped = new Map<string, LocalSkillEntry>();
	for (const entry of rawEntries) {
		const existing = deduped.get(entry.skill.name);
		if (!existing) {
			deduped.set(entry.skill.name, entry);
			continue;
		}
		deduped.set(entry.skill.name, getPreferredEntry(existing, entry));
	}

	return Array.from(deduped.values()).sort((a, b) => a.skill.name.localeCompare(b.skill.name));
}

/**
 * Resolves the canonical active local entry for a logical skill.
 * Exact skill name wins; server id is used to bind already synced skills.
 */
export async function findLocalSkillEntry(
	localSkillsDir: string,
	skillName: string,
	serverSkillId?: string
): Promise<LocalSkillEntry | null> {
	const entries = await listLocalSkillEntries(localSkillsDir);
	const exactCanonicalFileName = sanitizeSkillFolderName(skillName);
	const candidates = entries.filter(
		(entry) =>
			(typeof serverSkillId === 'string' && entry.serverSkillId === serverSkillId) ||
			entry.skill.name === skillName ||
			entry.fileName === exactCanonicalFileName ||
			entry.fileName === getLegacyNormalizedSkillName(skillName)
	);
	if (candidates.length === 0) {
		return null;
	}
	return candidates.sort((left, right) => {
		const preferred = getPreferredEntry(left, right);
		return preferred === left ? -1 : 1;
	})[0] ?? null;
}

/**
 * Migrates legacy normalized folders to canonical exact-name folders.
 * If both folders exist, the legacy copy is quarantined to keep exact-name folder authoritative.
 */
export async function migrateLegacySkillFolder(params: {
	localSkillsDir: string;
	quarantineDir: string;
	skillName: string;
}): Promise<{ canonicalPath: string; renamedLegacy: boolean; quarantinedLegacyPath: string | null }> {
	const canonicalFolderName = sanitizeSkillFolderName(params.skillName);
	const legacyFolderName = getLegacyNormalizedSkillName(params.skillName);
	const canonicalPath = join(params.localSkillsDir, canonicalFolderName);
	const legacyPath = join(params.localSkillsDir, legacyFolderName);

	if (canonicalPath === legacyPath || !existsSync(legacyPath)) {
		return { canonicalPath, renamedLegacy: false, quarantinedLegacyPath: null };
	}

	if (!existsSync(canonicalPath)) {
		await rename(legacyPath, canonicalPath);
		return { canonicalPath, renamedLegacy: true, quarantinedLegacyPath: null };
	}

	const quarantinedLegacyPath = await quarantineSkillFolder({
		folderPath: legacyPath,
		quarantineDir: params.quarantineDir,
		skillName: params.skillName
	});
	return { canonicalPath, renamedLegacy: false, quarantinedLegacyPath };
}

/**
 * Moves a no-longer-canonical folder out of the active skills directory without deleting data.
 */
export async function quarantineSkillFolder(params: {
	folderPath: string;
	quarantineDir: string;
	skillName: string;
}): Promise<string> {
	await mkdir(params.quarantineDir, { recursive: true });
	const baseName = sanitizeSkillFolderName(params.skillName);
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	let targetPath = join(params.quarantineDir, `${baseName}__legacy__${timestamp}`);
	let suffix = 1;
	while (existsSync(targetPath)) {
		targetPath = join(params.quarantineDir, `${baseName}__legacy__${timestamp}_${suffix}`);
		suffix += 1;
	}
	await rename(params.folderPath, targetPath);
	return targetPath;
}

export function getCanonicalSkillFolderPath(localSkillsDir: string, skillName: string): string {
	return join(localSkillsDir, sanitizeSkillFolderName(skillName));
}

export function getLegacySkillFolderPath(localSkillsDir: string, skillName: string): string {
	return join(localSkillsDir, getLegacyNormalizedSkillName(skillName));
}

export function hasExistingSkillFolder(localSkillsDir: string, skillName: string): boolean {
	return (
		existsSync(getCanonicalSkillFolderPath(localSkillsDir, skillName)) ||
		existsSync(getLegacySkillFolderPath(localSkillsDir, skillName))
	);
}

export function getRemoteCacheFolderPath(remoteCacheDir: string, skillName: string): string {
	return join(remoteCacheDir, sanitizeSkillFolderName(skillName));
}

export function getCanonicalChainStateFileName(skillName: string): string {
	return `${getCanonicalChainStateKey(skillName)}.json`;
}

export function getLegacyChainStateFileName(skillName: string): string {
	return `${getLegacyNormalizedSkillName(skillName)}.json`;
}
