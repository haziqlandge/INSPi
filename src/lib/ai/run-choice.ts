import type { Settings } from '../settings';
import type { RunChoice } from '../types';
import { hasKeys, PROVIDERS, providerChain, requestModelId, type ProviderSetup } from './registry';
import { isProviderId } from './status';

const NO_SPACES = /^\S{1,120}$/;

/**
 * The provider and models a retry asked for, if it asked. Null means "use the one in use".
 * The error is a sentence to show as it is.
 */
export function readRun(body: unknown, env: NodeJS.ProcessEnv = process.env): RunChoice | null | { error: string } {
  const run = (body && typeof body === 'object' ? (body as { run?: unknown }).run : undefined) as Record<string, unknown> | undefined;
  if (!run || typeof run !== 'object') return null;
  if (!isProviderId(run.provider)) return { error: 'Unknown provider.' };
  const provider = run.provider;
  if (!hasKeys(provider, env)) return { error: `Add ${PROVIDERS[provider].keyEnv.join(' and ')} to .env and restart the server.` };

  const choice: RunChoice = { provider };
  for (const job of ['vision', 'text'] as const) {
    const raw = run[job];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== 'string') return { error: 'Model ids have no spaces.' };
    const id = raw.trim();
    if (!id) continue;
    if (!NO_SPACES.test(id)) return { error: 'Model ids have no spaces.' };
    choice[job] = requestModelId(provider, id);
  }
  return choice;
}

/**
 * The providers an analysis may use: the run's alone when the job names one (its models, or the
 * ones saved for that provider); otherwise the provider in use, followed by the rest in order only
 * when the person turned on "next in line".
 */
export function chainFor(run: RunChoice | null, settings: Settings, env: NodeJS.ProcessEnv = process.env): ProviderSetup[] {
  if (!run) {
    const chain = providerChain(settings.order, settings.models, env);
    // Next in line (off by default): if the provider in use fails, the next one in the person's order tries.
    return settings.nextInLine ? chain : chain.slice(0, 1);
  }
  const saved = settings.models[run.provider] ?? {};
  return providerChain([run.provider], { [run.provider]: { vision: run.vision ?? saved.vision, text: run.text ?? saved.text } }, env).slice(0, 1);
}
