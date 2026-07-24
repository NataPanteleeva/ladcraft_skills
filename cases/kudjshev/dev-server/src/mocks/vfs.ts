import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';

export interface LocalVfsApi {
	read(filePath: string): Promise<string>;
	write(filePath: string, content: string): Promise<void>;
	list(dirPath?: string): Promise<Array<{ name: string; type: 'file' | 'directory' }>>;
	delete(path: string): Promise<void>;
	readFile(filePath: string): Promise<string>;
	writeFile(filePath: string, content: string): Promise<void>;
	listDir(dirPath?: string): Promise<Array<{ name: string; type: 'file' | 'directory' }>>;
	mkdir(dirPath: string): Promise<void>;
	rm(path: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	isDir(path: string): Promise<boolean>;
}

function resolveSafePath(root: string, targetPath: string): string {
	const normalized = normalize(targetPath).replace(/^\/+/, '');
	const fullPath = resolve(join(root, normalized));
	const fullRoot = resolve(root);
	if (!fullPath.startsWith(fullRoot)) {
		throw new Error('Path escapes VFS root');
	}
	return fullPath;
}

export function createLocalVfs(root: string): LocalVfsApi {
	return {
		read: async (filePath: string) => {
			const target = resolveSafePath(root, filePath);
			return readFile(target, 'utf-8');
		},
		write: async (filePath: string, content: string) => {
			const target = resolveSafePath(root, filePath);
			await mkdir(resolveSafePath(root, '.'), { recursive: true });
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, content, 'utf-8');
		},
		list: async (dirPath = '.') => {
			const target = resolveSafePath(root, dirPath);
			await mkdir(target, { recursive: true });
			const entries = await readdir(target, { withFileTypes: true });
			return entries.map((entry) => ({
				name: entry.name,
				type: entry.isDirectory() ? 'directory' : 'file'
			}));
		},
		delete: async (targetPath: string) => {
			const target = resolveSafePath(root, targetPath);
			const entryStat = await stat(target);
			if (entryStat.isDirectory()) {
				await rm(target, { recursive: true, force: true });
				return;
			}
			await rm(target, { force: true });
		},
		readFile: async (filePath: string) => {
			const target = resolveSafePath(root, filePath);
			return readFile(target, 'utf-8');
		},
		writeFile: async (filePath: string, content: string) => {
			const target = resolveSafePath(root, filePath);
			await mkdir(resolveSafePath(root, '.'), { recursive: true });
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, content, 'utf-8');
		},
		listDir: async (dirPath = '.') => {
			const target = resolveSafePath(root, dirPath);
			await mkdir(target, { recursive: true });
			const entries = await readdir(target, { withFileTypes: true });
			return entries.map((entry) => ({
				name: entry.name,
				type: entry.isDirectory() ? 'directory' : 'file'
			}));
		},
		mkdir: async (dirPath: string) => {
			const target = resolveSafePath(root, dirPath);
			await mkdir(target, { recursive: true });
		},
		rm: async (targetPath: string) => {
			const target = resolveSafePath(root, targetPath);
			const entryStat = await stat(target).catch(() => null);
			if (!entryStat) {
				return;
			}
			if (entryStat.isDirectory()) {
				await rm(target, { recursive: true, force: true });
				return;
			}
			await rm(target, { force: true });
		},
		exists: async (targetPath: string) => {
			const target = resolveSafePath(root, targetPath);
			const entryStat = await stat(target).catch(() => null);
			return entryStat != null;
		},
		isDir: async (targetPath: string) => {
			const target = resolveSafePath(root, targetPath);
			const entryStat = await stat(target).catch(() => null);
			return entryStat?.isDirectory() === true;
		}
	};
}
