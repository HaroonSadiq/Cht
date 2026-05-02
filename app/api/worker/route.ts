import { NextRequest } from 'next/server';
import legacy from '@/lib/handlers/worker';
import { adapt } from '@/lib/vercel-next-adapter';

export const dynamic = 'force-dynamic';
// Worker can take a while when draining a backlog. Vercel cron and
// the public-facing route both hit this Route Handler.
export const maxDuration = 60;

export async function GET(req: NextRequest)  { return adapt(req, legacy as any); }
export async function POST(req: NextRequest) { return adapt(req, legacy as any); }
