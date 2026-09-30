import { providerStatuses } from '@/lib/ai/status';
import { ok } from '@/lib/http';
import { readSettings } from '@/lib/settings';
import { library } from '@/lib/store';

export async function GET() {
  return ok({ providers: providerStatuses(readSettings(library())) });
}
