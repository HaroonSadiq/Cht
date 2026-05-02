import { NextRequest } from 'next/server';
import legacy from '@/api/jobs/[id]';
import { adapt } from '@/lib/vercel-next-adapter';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  return adapt(req, legacy as any, { id: params.id });
}
export async function POST(req: NextRequest, { params }: Ctx) {
  return adapt(req, legacy as any, { id: params.id });
}
