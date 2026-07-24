import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

export type BundleUpdateStage =
	| 'idle'
	| 'starting'
	| 'downloading'
	| 'unpacking'
	| 'backing_up'
	| 'applying'
	| 'restarting'
	| 'completed'
	| 'failed'
	| 'rollback_starting'
	| 'rollback_applying'
	| 'rolled_back';

export type BundleUpdateMode = 'update' | 'rollback' | null;

export type BundleUpdateStatus = {
	state: 'idle' | 'running' | 'success' | 'failed';
	mode: BundleUpdateMode;
	stage: BundleUpdateStage;
	message: string;
	runId: string | null;
	startedAt: string | null;
	finishedAt: string | null;
	currentVersion: string | null;
	targetVersion: string | null;
	backupPath: string | null;
	lastError: string | null;
	preserveSkills: boolean;
	updatedAt: string;
};

export type StartBundleUpdateOptions = {
	currentVersion: string | null;
	targetVersion: string | null;
	prototypeBaseUrl: string;
	prototypeToken: string;
	serverPid: number;
};

export type StartBundleRollbackOptions = {
	serverPid: number;
};

type UpdateManagerOptions = {
	workspaceRoot: string;
	launcherPath: string;
	statusFilePath: string;
	backupMetaFilePath: string;
};

const idleStatus: BundleUpdateStatus = {
	state: 'idle',
	mode: null,
	stage: 'idle',
	message: 'Ожидание запуска обновления',
	runId: null,
	startedAt: null,
	finishedAt: null,
	currentVersion: null,
	targetVersion: null,
	backupPath: null,
	lastError: null,
	preserveSkills: true,
	updatedAt: new Date(0).toISOString()
};

type BackupMeta = {
	backupPath: string;
	createdAt: string;
};

export class BundleUpdateManager {
	private readonly workspaceRoot: string;
	private readonly launcherPath: string;
	private readonly statusFilePath: string;
	private readonly backupMetaFilePath: string;

	constructor(options: UpdateManagerOptions) {
		this.workspaceRoot = options.workspaceRoot;
		this.launcherPath = options.launcherPath;
		this.statusFilePath = options.statusFilePath;
		this.backupMetaFilePath = options.backupMetaFilePath;
	}

	async getStatus(): Promise<BundleUpdateStatus> {
		const fromDisk = await this.readStatusFromDisk();
		return fromDisk ?? idleStatus;
	}

	async startUpdate(options: StartBundleUpdateOptions): Promise<BundleUpdateStatus> {
		const token = options.prototypeToken.trim();
		if (!token) {
			throw new Error('Токен prototype API не настроен: запуск автообновления невозможен.');
		}
		await this.assertNotRunning();
		await this.assertLauncherExists();

		const now = new Date().toISOString();
		const runId = randomUUID();
		const status: BundleUpdateStatus = {
			state: 'running',
			mode: 'update',
			stage: 'starting',
			message: 'Запускаем процесс автообновления...',
			runId,
			startedAt: now,
			finishedAt: null,
			currentVersion: options.currentVersion?.trim() || null,
			targetVersion: options.targetVersion?.trim() || null,
			backupPath: null,
			lastError: null,
			preserveSkills: true,
			updatedAt: now
		};
		await this.writeStatusToDisk(status);
		await this.spawnLauncherProcess(
			[
				'--mode',
				'update',
				'--workspace-root',
				this.workspaceRoot,
				'--status-file',
				this.statusFilePath,
				'--backup-meta-file',
				this.backupMetaFilePath,
				'--prototype-base-url',
				options.prototypeBaseUrl,
				'--current-version',
				status.currentVersion ?? '',
				'--target-version',
				status.targetVersion ?? '',
				'--run-id',
				runId,
				'--server-pid',
				String(options.serverPid)
			],
			{
				CURSOR_LADCRAFT_PROTOTYPE_TOKEN: token
			}
		);
		return status;
	}

	async startRollback(options: StartBundleRollbackOptions): Promise<BundleUpdateStatus> {
		await this.assertNotRunning();
		await this.assertLauncherExists();
		const backup = await this.readLastBackupMeta();
		if (!backup?.backupPath) {
			throw new Error('Нет доступного backup для rollback.');
		}
		const now = new Date().toISOString();
		const runId = randomUUID();
		const status: BundleUpdateStatus = {
			state: 'running',
			mode: 'rollback',
			stage: 'rollback_starting',
			message: 'Запускаем rollback...',
			runId,
			startedAt: now,
			finishedAt: null,
			currentVersion: null,
			targetVersion: null,
			backupPath: backup.backupPath,
			lastError: null,
			preserveSkills: true,
			updatedAt: now
		};
		await this.writeStatusToDisk(status);
		await this.spawnLauncherProcess(
			[
				'--mode',
				'rollback',
				'--workspace-root',
				this.workspaceRoot,
				'--status-file',
				this.statusFilePath,
				'--backup-meta-file',
				this.backupMetaFilePath,
				'--backup-path',
				backup.backupPath,
				'--run-id',
				runId,
				'--server-pid',
				String(options.serverPid)
			],
			{}
		);
		return status;
	}

	private async assertLauncherExists(): Promise<void> {
		if (!existsSync(this.launcherPath)) {
			throw new Error(`Launcher не найден: ${this.launcherPath}`);
		}
	}

	private async assertNotRunning(): Promise<void> {
		const status = await this.getStatus();
		if (status.state === 'running') {
			throw new Error('Обновление уже выполняется.');
		}
	}

	private async readLastBackupMeta(): Promise<BackupMeta | null> {
		try {
			if (!existsSync(this.backupMetaFilePath)) return null;
			const raw = await readFile(this.backupMetaFilePath, 'utf-8');
			const parsed = JSON.parse(raw) as Partial<BackupMeta>;
			if (!parsed || typeof parsed.backupPath !== 'string' || !parsed.backupPath.trim()) {
				return null;
			}
			return {
				backupPath: parsed.backupPath,
				createdAt:
					typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date(0).toISOString()
			};
		} catch {
			return null;
		}
	}

	private async readStatusFromDisk(): Promise<BundleUpdateStatus | null> {
		try {
			if (!existsSync(this.statusFilePath)) return null;
			const raw = await readFile(this.statusFilePath, 'utf-8');
			const parsed = JSON.parse(raw) as Partial<BundleUpdateStatus>;
			if (!parsed || typeof parsed !== 'object') return null;
			return {
				...idleStatus,
				...parsed,
				updatedAt:
					typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
				preserveSkills: true
			};
		} catch {
			return null;
		}
	}

	private async writeStatusToDisk(status: BundleUpdateStatus): Promise<void> {
		await mkdir(dirname(this.statusFilePath), { recursive: true });
		await writeFile(this.statusFilePath, JSON.stringify(status, null, 2), 'utf-8');
	}

	private async spawnLauncherProcess(
		args: string[],
		extraEnv: Record<string, string>
	): Promise<void> {
		const child = spawn(process.execPath, [this.launcherPath, ...args], {
			cwd: this.workspaceRoot,
			detached: true,
			stdio: 'ignore',
			env: {
				...process.env,
				...extraEnv
			}
		});
		child.unref();
	}
}
