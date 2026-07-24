import path from 'node:path';
import { config } from '../src/config.js';
import {
	generateCompatibilityAuditReport,
	getAuditJsonPath,
	getAuditMarkdownPath,
	writeCompatibilityAuditReport
} from '../src/compatibility-audit.js';

async function main(): Promise<void> {
	const cursorLadcraftRoot = path.dirname(config.localSkillsDir);
	const report = await generateCompatibilityAuditReport({
		skillsRootPath: config.localSkillsDir,
		cursorLadcraftRoot
	});
	await writeCompatibilityAuditReport(config.localSkillsDir, report);
	console.log(`[audit-builder] scanned ${report.scannedSkills} skills`);
	console.log(`[audit-builder] findings: ${report.findings.length}`);
	console.log(`[audit-builder] json: ${getAuditJsonPath(config.localSkillsDir)}`);
	console.log(`[audit-builder] markdown: ${getAuditMarkdownPath(config.localSkillsDir)}`);
}

await main();
