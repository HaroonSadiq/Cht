import { NextRequest } from 'next/server';
import legacy from '@/lib/handlers/events';
import { adapt } from '@/lib/vercel-next-adapter';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) { return adapt(req, legacy as any); }
