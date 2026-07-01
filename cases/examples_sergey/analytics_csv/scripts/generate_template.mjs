/**
 * One-time dev script: builds sales_report_template.xlsx with 5 sheets and charts.
 * Run from cases/analytics_csv: node scripts/generate_template.mjs
 */
import ExcelJS from 'exceljs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'analytics_csv', 'templates');
const outPath = join(outDir, 'sales_report_template.xlsx');

function addBarChart(ws, title, categories, values, anchor) {
	ws.addChart({
		type: 'bar',
		title: { name: title },
		legend: { position: 'bottom' },
		plotArea: {
			dataSeries: [
				{
					title: values.title,
					categories: { ranges: [categories] },
					values: { ranges: [values] }
				}
			]
		},
		anchor: anchor || { col: 4, row: 0, nativeCol: 4, nativeRow: 0 }
	});
}

function addLineChart(ws, title, categories, values, anchor) {
	ws.addChart({
		type: 'line',
		title: { name: title },
		legend: { position: 'bottom' },
		plotArea: {
			dataSeries: [
				{
					title: values.title,
					categories: { ranges: [categories] },
					values: { ranges: [values] }
				}
			]
		},
		anchor: anchor || { col: 4, row: 0, nativeCol: 4, nativeRow: 0 }
	});
}

function addPieChart(ws, title, categories, values, anchor) {
	ws.addChart({
		type: 'pie',
		title: { name: title },
		legend: { position: 'right' },
		plotArea: {
			dataSeries: [
				{
					title: values.title,
					categories: { ranges: [categories] },
					values: { ranges: [values] }
				}
			]
		},
		anchor: anchor || { col: 4, row: 0, nativeCol: 4, nativeRow: 0 }
	});
}

async function main() {
	const wb = new ExcelJS.Workbook();
	wb.creator = 'analytics_csv';
	wb.created = new Date();

	// Sheet 1: Сводка
	const summary = wb.addWorksheet('Сводка');
	summary.columns = [
		{ header: 'Метрика', key: 'metric', width: 28 },
		{ header: 'Значение', key: 'value', width: 18 }
	];
	summary.addRows([
		{ metric: 'Число покупок (cart)', value: 0 },
		{ metric: 'Выручка, руб.', value: 0 },
		{ metric: 'Средний чек, руб.', value: 0 },
		{ metric: 'Уникальные покупатели', value: 0 }
	]);
	addBarChart(summary, 'Сводка по продажам', "'Сводка'!$A$2:$A$5", {
		title: 'Значение',
		ranges: ["'Сводка'!$B$2:$B$5"]
	});

	// Sheet 2: Бренды
	const brands = wb.addWorksheet('Бренды');
	brands.columns = [
		{ header: 'Бренд', key: 'brand', width: 22 },
		{ header: 'Покупки', key: 'count', width: 12 },
		{ header: 'Выручка, руб.', key: 'revenue', width: 16 },
		{ header: 'Доля, %', key: 'share', width: 10 }
	];
	for (let i = 0; i < 10; i++) {
		brands.addRow({ brand: '', count: 0, revenue: 0, share: 0 });
	}
	addBarChart(brands, 'Топ брендов по покупкам', "'Бренды'!$A$2:$A$11", {
		title: 'Покупки',
		ranges: ["'Бренды'!$B$2:$B$11"]
	});

	// Sheet 3: Категории
	const categories = wb.addWorksheet('Категории');
	categories.columns = [
		{ header: 'Категория', key: 'category', width: 36 },
		{ header: 'Покупки', key: 'count', width: 12 },
		{ header: 'Выручка, руб.', key: 'revenue', width: 16 },
		{ header: 'Доля, %', key: 'share', width: 10 }
	];
	for (let i = 0; i < 10; i++) {
		categories.addRow({ category: '', count: 0, revenue: 0, share: 0 });
	}
	addPieChart(categories, 'Категории по покупкам', "'Категории'!$A$2:$A$11", {
		title: 'Покупки',
		ranges: ["'Категории'!$B$2:$B$11"]
	});

	// Sheet 4: Воронка
	const funnel = wb.addWorksheet('Воронка');
	funnel.columns = [
		{ header: 'Этап', key: 'stage', width: 22 },
		{ header: 'Количество', key: 'count', width: 14 },
		{ header: 'Конверсия, %', key: 'conversion', width: 14 }
	];
	funnel.addRows([
		{ stage: 'Просмотры (view)', count: 0, conversion: 100 },
		{ stage: 'Покупки (purchase)', count: 0, conversion: 0 }
	]);
	addBarChart(funnel, 'Воронка продаж', "'Воронка'!$A$2:$A$3", {
		title: 'Количество',
		ranges: ["'Воронка'!$B$2:$B$3"]
	});

	// Sheet 5: Динамика
	const dynamics = wb.addWorksheet('Динамика');
	dynamics.columns = [
		{ header: 'Дата', key: 'date', width: 14 },
		{ header: 'Покупки', key: 'count', width: 12 },
		{ header: 'Выручка, руб.', key: 'revenue', width: 16 }
	];
	for (let i = 0; i < 31; i++) {
		dynamics.addRow({ date: '', count: 0, revenue: 0 });
	}
	addLineChart(dynamics, 'Динамика покупок', "'Динамика'!$A$2:$A$32", {
		title: 'Покупки',
		ranges: ["'Динамика'!$B$2:$B$32"]
	});

	await mkdir(outDir, { recursive: true });
	await wb.xlsx.writeFile(outPath);
	console.log('Written:', outPath);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
