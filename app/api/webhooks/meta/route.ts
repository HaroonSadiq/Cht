import { NextRequest } from 'next/server';
import legacy from '@/lib/handlers/webhooks/meta';
import { adapt } from '@/lib/vercel-next-adapter';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function GET(req: NextRequest)  { return adapt(req, legacy as any); }
export async function POST(req: NextRequest) { return adapt(req, legacy as any); }
