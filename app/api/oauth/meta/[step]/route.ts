import { NextRequest } from 'next/server';
import legacy from '@/api/oauth/meta/[step]';
import { adapt } from '@/lib/vercel-next-adapter';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

type Ctx = { params: { step: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  return adapt(req, legacy as any, { step: params.step });
}
export async function POST(req: NextRequest, { params }: Ctx) {
  return adapt(req, legacy as any, { step: params.step });
}
