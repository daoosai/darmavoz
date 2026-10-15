import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Isolated server QA can use the system Chromium supplied by its test container.
export default defineConfig({
  ...base,
  workers: 1,
  projects: base.projects?.map((project) => ({
    ...project,
    use: {
      ...project.use,
      launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
    },
  })),
});
