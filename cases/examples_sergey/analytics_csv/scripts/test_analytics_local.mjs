/**
 * Local smoke test for CSV analytics + XLSX builder (no R7 network).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = join(__dirname, '..');
const scriptsDir = join(root, 'analytics_csv', 'scripts');

function loadLibs() {
	const chunks = [
		'xlsx_template.b64.js',
		'csv_analytics.lib.js',
		'r7_disk_client.lib.js',
		'xlsx_report_builder.lib.js'
	];
	let code = '';
	for (const name of chunks) {
		code += readFileSync(join(scriptsDir, name), 'utf8') + '\n';
	}
	const fn = new Function('require', `${code}; return { analyzeCsvText, buildSalesReportXlsx };`);
	return fn(require);
}

const csvPath = join(root, 'data_first_1000.csv');
const csvText = readFileSync(csvPath, 'utf8');
const { analyzeCsvText, buildSalesReportXlsx } = loadLibs();

const result = analyzeCsvText(csvText);
if (!result.ok) {
	console.error('FAIL:', result.error);
	process.exit(1);
}

const { analytics, rowCount } = result;
console.log('Rows:', rowCount);
console.log('Summary:', analytics.summary);
console.log('Top brand:', analytics.brands[0]);
console.log('Funnel:', analytics.funnel);

const xlsxBytes = buildSalesReportXlsx(analytics);
const outPath = join(root, 'analytics_csv', 'templates', 'sales_report_test_output.xlsx');
writeFileSync(outPath, xlsxBytes);
console.log('Written:', outPath, xlsxBytes.length, 'bytes');
