import { NextRequest } from 'next/server';
import legacy from '@/api/conversations/[contactId]/[action]';
import { adapt } from '@/lib/vercel-next-adapter';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

type Ctx = { params: { contactId: string; action: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  return adapt(req, legacy as any, params);
}
export async function POST(req: NextRequest, { params }: Ctx) {
  return adapt(req, legacy as any, params);
}
