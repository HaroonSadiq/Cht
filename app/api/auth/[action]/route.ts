import { NextRequest } from 'next/server';
import legacy from '@/lib/handlers/auth/[action]';
import { adapt } from '@/lib/vercel-next-adapter';

export const dynamic = 'force-dynamic';

type Ctx = { params: { action: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  return adapt(req, legacy as any, { action: params.action });
}
export async function POST(req: NextRequest, { params }: Ctx) {
  return adapt(req, legacy as any, { action: params.action });
}
