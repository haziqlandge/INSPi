import { chatJson, type ChatResult } from './client';
import type { ProviderSetup } from './registry';
import type { Parsed } from './schema/wire';

const SYSTEM = `You describe what a picture shows so that another artist, who never sees it, could paint the same picture again.
Name the main subject or subjects, what they look like and what they are doing, where they sit in the frame and how big they are, the setting, and any notable objects or visible text (quoted exactly).
Do not describe the style, medium, colours, light or technique; those are recorded separately.
Write 2 to 4 plain sentences. Output only the JSON object.`;

const SCHEMA = {
  type: 'object',
  properties: { subject: { type: 'string' } },
  required: ['subject'],
  additionalProperties: false,
};

function parse(raw: unknown): Parsed<{ subject: string }> {
  const subject = raw && typeof raw === 'object' ? (raw as { subject?: unknown }).subject : undefined;
  if (typeof subject !== 'string' || subject.trim().length < 3) return { ok: false, issues: ['subject: expected a few sentences'] };
  return { ok: true, data: { subject: subject.trim().replace(/\s+/g, ' ').slice(0, 1200) } };
}

/**
 * One small vision call: what the reference shows (subject, arrangement, setting), for entries made
 * before the analysis kept it. Uses the provider's reading model and its first key.
 */
export async function describeSubject(
  image: string,
  setup: ProviderSetup,
  chat: typeof chatJson = chatJson,
): Promise<{ subject: string; usage: ChatResult<unknown>['usage'] }> {
  const result = await chat({
    provider: setup.runtime,
    model: setup.vision,
    system: SYSTEM,
    user: 'Describe what this picture shows.',
    images: [image],
    schema: { name: 'subject', json: SCHEMA, shape: '{"subject": "…"}', parse },
    maxTokens: 400,
    temperature: 0.2,
  });
  return { subject: result.data.subject, usage: result.usage };
}
