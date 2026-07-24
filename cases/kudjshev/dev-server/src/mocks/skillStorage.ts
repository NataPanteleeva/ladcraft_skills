import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

type PersistedStorage = Record<string, Record<string, string>>;

export interface SkillStorageApi {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	delete(key: string): Promise<void>;
	clear(): Promise<void>;
	getAll(): Promise<Record<string, string>>;
}

export class SkillStorageManager {
	private filePath: string;
	private cache: PersistedStorage | null = null;

	constructor(filePath: string) {
		this.filePath = filePath;
	}

	private async load(): Promise<PersistedStorage> {
		if (this.cache) return this.cache;

		if (!existsSync(this.filePath)) {
			await mkdir(dirname(this.filePath), { recursive: true });
			this.cache = {};
			return this.cache;
		}

		try {
			const raw = await readFile(this.filePath, 'utf-8');
			const parsed = JSON.parse(raw) as PersistedStorage;
			this.cache = parsed;
			return parsed;
		} catch {
			this.cache = {};
			return this.cache;
		}
	}

	private async persist(data: PersistedStorage): Promise<void> {
		await mkdir(dirname(this.filePath), { recursive: true });
		await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
	}

	forSkill(skillName: string): SkillStorageApi {
		const resolvedSkill = skillName.trim() || 'default-skill';
		return {
			get: async (key: string) => {
				const data = await this.load();
				const bucket = data[resolvedSkill] || {};
				return bucket[key] ?? null;
			},
			set: async (key: string, value: string) => {
				const data = await this.load();
				if (!data[resolvedSkill]) data[resolvedSkill] = {};
				data[resolvedSkill][key] = value;
				await this.persist(data);
			},
			delete: async (key: string) => {
				const data = await this.load();
				if (!data[resolvedSkill]) return;
				delete data[resolvedSkill][key];
				await this.persist(data);
			},
			clear: async () => {
				const data = await this.load();
				data[resolvedSkill] = {};
				await this.persist(data);
			},
			getAll: async () => {
				const data = await this.load();
				return { ...(data[resolvedSkill] || {}) };
			}
		};
	}
}
