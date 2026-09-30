import type { NextRequest } from 'next/server';
import { providerStatuses } from '@/lib/ai/status';
import { crossOrigin, ok, readJson } from '@/lib/http';
import { readSettings, writeSettings } from '@/lib/settings';
import { library } from '@/lib/store';

export async function GET() {
  const settings = readSettings(library());
  return ok({ settings, providers: providerStatuses(settings) });
}

export async function PUT(request: NextRequest) {
  const blocked = crossOrigin(request);
  if (blocked) return blocked;
  const settings = writeSettings(library(), await readJson(request));
  return ok({ settings, providers: providerStatuses(settings) });
}
