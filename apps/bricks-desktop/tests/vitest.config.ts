// Unit tests for the pure frontend logic and React components.
// Run from apps/bricks-desktop: npm run test:unit
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const appRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
	root: appRoot,
	plugins: [react()],
	resolve: {
		alias: { $lib: fileURLToPath(new URL('../src/lib', import.meta.url)) }
	},
	test: {
		environment: 'node',
		include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
		setupFiles: ['tests/unit/setup-language.ts']
	}
});
