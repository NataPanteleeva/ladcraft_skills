export type SkillIdentity = {
	name: string;
	serverSkillId?: string | null;
};

/**
 * Legacy folder naming used by the original dev-server implementation.
 * Kept only for migration of already existing local folders and chain-state files.
 */
export function getLegacyNormalizedSkillName(name: string): string {
	const cleaned = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
	return cleaned || 'skill';
}

/**
 * Builds a safe folder/file component while preserving the exact skill name as much as possible.
 * Dots and casing are preserved; only path-dangerous characters are sanitized.
 */
export function sanitizeSkillFolderName(name: string): string {
	const trimmed = name.trim();
	const sanitized = trimmed
		.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
		.replace(/[. ]+$/g, '');
	if (!sanitized || sanitized === '.' || sanitized === '..') {
		return 'skill';
	}
	return sanitized;
}

/**
 * Stable identity key for UI and sync state.
 * Server-linked skills are keyed by server id; purely local skills by exact name.
 */
export function getSkillIdentityKey(identity: SkillIdentity): string {
	if (typeof identity.serverSkillId === 'string' && identity.serverSkillId.trim().length > 0) {
		return `server:${identity.serverSkillId}`;
	}
	return `name:${identity.name}`;
}

/**
 * Canonical chain-state key now follows the exact skill name.
 */
export function getCanonicalChainStateKey(skillName: string): string {
	return sanitizeSkillFolderName(skillName);
}
