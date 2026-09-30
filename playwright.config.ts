import { defineConfig } from '@playwright/test';

// The built app in a real browser, against the fake vangogh. Run `npm run build` first.
// tests/e2e/setup.ts starts both and puts their addresses into the environment.
export default defineConfig({
	testDir: 'tests/e2e',
	globalSetup: './tests/e2e/setup.ts',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: 0,
	reporter: 'list',
	timeout: 30_000,
	use: {
		// A desktop with a real scrollbar: the tests measure that nothing jumps.
		viewport: { width: 1440, height: 900 },
		launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] },
		trace: 'retain-on-failure'
	},
	projects: [{ name: 'chromium', use: { browserName: 'chromium' } }]
});
