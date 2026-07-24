import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const webUiPort = Number(process.env.WEB_UI_PORT || 5174);
const apiPort = Number(process.env.DEV_SERVER_PORT || 4321);

export default defineConfig({
	plugins: [svelte()],
	server: {
		port: Number.isFinite(webUiPort) ? webUiPort : 5174,
		host: '0.0.0.0',
		proxy: {
			'/api': {
				target: `http://127.0.0.1:${apiPort}`,
				changeOrigin: true
			}
		}
	}
});
