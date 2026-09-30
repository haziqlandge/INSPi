import type { NextRequest } from 'next/server';
import { isProviderId, listModels } from '@/lib/ai/status';
import { fail, ok } from '@/lib/http';

/** Lists the models a provider's key can use; also serves as the connection test. */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('provider');
  if (!isProviderId(id)) return fail(400, 'Unknown provider.');
  return ok(await listModels(id));
}
