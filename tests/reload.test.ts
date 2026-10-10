import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The dev server re-evaluates changed modules but keeps globalThis. These tests load a module
// twice (vi.resetModules) to stand in for that reload.

interface WorkerHandle {
  retire?: () => Promise<void>;
}
const globals = globalThis as {
  __inspiLibraries?: Map<unknown, { close(): void }>;
  __inspiWorker?: WorkerHandle;
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'inspi-reload-'));
  process.env.INSPI_DATA_DIR = dir;
});

afterEach(async () => {
  await globals.__inspiWorker?.retire?.();
  delete globals.__inspiWorker;
  for (const lib of globals.__inspiLibraries?.values() ?? []) lib.close();
  delete globals.__inspiLibraries;
  delete process.env.INSPI_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('store after a code reload', () => {
  it('hands out an instance of the reloaded Library class, so new methods exist', async () => {
    vi.resetModules();
    const before = await import('@/lib/store');
    const first = before.library();

    vi.resetModules();
    const after = await import('@/lib/store');
    const { Library } = await import('@/lib/store/library');
    const second = after.library();

    expect(second).toBeInstanceOf(Library);
    expect(after.library()).toBe(second);
    // Code still running from before the reload keeps its own connection.
    expect(before.library()).toBe(first);
  });
});

describe('worker after a code reload', () => {
  it('retires the old loop and starts one running the new code', async () => {
    vi.resetModules();
    const before = await import('@/lib/jobs/worker');
    before.ensureWorker();
    const old = globals.__inspiWorker;
    expect(old?.retire).toBeTypeOf('function');

    vi.resetModules();
    const after = await import('@/lib/jobs/worker');
    after.ensureWorker();
    const current = globals.__inspiWorker;
    expect(current).not.toBe(old);

    // The old loop stops (it was idle), and calling again from the same code keeps the new loop.
    await expect(old!.retire!()).resolves.toBeUndefined();
    after.ensureWorker();
    expect(globals.__inspiWorker).toBe(current);
  });
});
