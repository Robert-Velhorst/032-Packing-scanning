import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach } from 'vitest';

const directories = new Set<string>();

export async function createTestTempDirectory(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.add(directory);
  return directory;
}

async function cleanupTestTempDirectories() {
  const failures: { directory: string; error: unknown }[] = [];
  await Promise.all([...directories].map(async directory => {
    try {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      directories.delete(directory);
    } catch (error) {
      failures.push({ directory, error });
    }
  }));
  if (failures.length) {
    throw new AggregateError(failures.map(({ directory, error }) => new Error(`Could not remove test directory ${directory}.`, { cause: error })), 'Some test temporary directories could not be removed.');
  }
}

afterEach(cleanupTestTempDirectories);
// Keep failed afterEach removals registered so the final file teardown gets one
// more attempt after databases, servers and other test resources have closed.
afterAll(cleanupTestTempDirectories);
