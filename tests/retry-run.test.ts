import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chainFor, readRun } from '@/lib/ai/run-choice';
import { readSettings } from '@/lib/settings';
import { openLibrary, type Library } from '@/lib/store/library';

const env = { GROQ_API_KEY: 'g', OPENROUTER_API_KEY: 'o' } as unknown as NodeJS.ProcessEnv;

describe('readRun', () => {
  it('is null when the retry does not choose a provider', () => {
    expect(readRun({ focus: [], note: '' }, env)).toBeNull();
    expect(readRun(null, env)).toBeNull();
  });

  it('accepts a provider with keys and trims the model ids, dropping OpenRouter’s :free', () => {
    expect(readRun({ run: { provider: 'openrouter', vision: ' google/gemma-4-31b-it:free ', text: '' } }, env)).toEqual({
      provider: 'openrouter',
      vision: 'google/gemma-4-31b-it',
    });
  });

  it('refuses a provider without keys, naming what to add', () => {
    expect(readRun({ run: { provider: 'gemini' } }, env)).toEqual({ error: 'Add GEMINI_API_KEY to .env and restart the server.' });
  });

  it('refuses an unknown provider and model ids with spaces', () => {
    expect(readRun({ run: { provider: 'skynet' } }, env)).toEqual({ error: 'Unknown provider.' });
    expect(readRun({ run: { provider: 'groq', vision: 'two words' } }, env)).toEqual({ error: 'Model ids have no spaces.' });
    expect(readRun({ run: { provider: 'groq', text: 'a\nb' } }, env)).toEqual({ error: 'Model ids have no spaces.' });
  });
});

describe('jobs carry the run choice', () => {
  let dir: string;
  let lib: Library;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'inspi-run-'));
    lib = openLibrary(dir);
  });
  afterEach(() => {
    lib.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const image = () => ({ id: `img${Math.random().toString(36).slice(2, 8)}`, width: 8, height: 8, bytes: 1, placeholder: '#000', sha256: 'x' });

  it('keeps steer and run together until the worker takes the job', () => {
    const entry = lib.createEntry({ mode: 'image', compress: false, images: [image()] });
    lib.enqueueJob(entry.id, 'retry', { focus: ['colour'], note: 'warmer' }, { provider: 'groq', vision: 'qwen/qwen3.8-27b' });
    expect(lib.takeJob()).toMatchObject({ steer: { focus: ['colour'], note: 'warmer' }, run: { provider: 'groq', vision: 'qwen/qwen3.8-27b' } });
  });

  it('gives a run without guidance a null steer', () => {
    const entry = lib.createEntry({ mode: 'image', compress: false, images: [image()] });
    lib.enqueueJob(entry.id, 'analyze', null, { provider: 'openrouter' });
    expect(lib.takeJob()).toMatchObject({ steer: null, run: { provider: 'openrouter' } });
  });

  it('carries the changes asked for when the entry was added, with no guidance', () => {
    const entry = lib.createEntry({ mode: 'image', compress: false, images: [image()] });
    lib.enqueueJob(entry.id, 'analyze', null, null, { changes: 'make it night time', subject: { mode: 'recreate' } });
    expect(lib.takeJob()).toMatchObject({ steer: null, run: null, changes: 'make it night time', subject: { mode: 'recreate' } });
  });

  it('reads jobs saved before runs existed', () => {
    const entry = lib.createEntry({ mode: 'image', compress: false, images: [image()] });
    lib.enqueueJob(entry.id, 'retry', { focus: [], note: 'x' });
    expect(lib.takeJob()).toMatchObject({ steer: { focus: [], note: 'x' }, run: null });
  });
});

describe('chainFor', () => {
  let dir: string;
  let lib: Library;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'inspi-chain-'));
    lib = openLibrary(dir);
  });
  afterEach(() => {
    lib.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('uses the provider in use when the job has no run', () => {
    const chain = chainFor(null, readSettings(lib), env);
    expect(chain.map((c) => c.runtime.id)).toEqual(['groq']);
  });

  it('uses only the run’s provider and models when given', () => {
    const chain = chainFor({ provider: 'openrouter', vision: 'some/vision', text: 'some/text' }, readSettings(lib), env);
    expect(chain.map((c) => [c.runtime.id, c.vision.id, c.text.id])).toEqual([['openrouter', 'some/vision', 'some/text']]);
  });

  it('falls back to the saved models for that provider when the run names none', () => {
    const settings = { ...readSettings(lib), models: { openrouter: { vision: 'saved/vision' } } };
    expect(chainFor({ provider: 'openrouter' }, settings, env)[0].vision.id).toBe('saved/vision');
  });
});

describe('next in line', () => {
  it('is off by default: only the provider in use runs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inspi-next-'));
    const lib = openLibrary(dir);
    try {
      expect(readSettings(lib).nextInLine).toBe(false);
      expect(chainFor(null, readSettings(lib), env).map((c) => c.runtime.id)).toEqual(['groq']);
    } finally {
      lib.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('when on, lines up every provider with a key in the person’s order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inspi-next-'));
    const lib = openLibrary(dir);
    try {
      const settings = { ...readSettings(lib), order: ['openrouter', 'gemini', 'groq'] as never, nextInLine: true };
      expect(chainFor(null, settings, env).map((c) => c.runtime.id)).toEqual(['openrouter', 'groq']);
      // A retry that names its own provider still uses only that one.
      expect(chainFor({ provider: 'groq' }, settings, env).map((c) => c.runtime.id)).toEqual(['groq']);
    } finally {
      lib.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
