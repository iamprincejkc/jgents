import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'client/src/**/*.test.ts'],
    environment: 'node',
    // The demo and layout tests simulate minutes of office in one go (about 3 s each on an idle machine): with the
    // default 5 s, any other load on the computer (a browser rendering the office, a build) made them time out. The
    // timeout is there to catch a hang, not to time them.
    testTimeout: 20_000,
  },
});
