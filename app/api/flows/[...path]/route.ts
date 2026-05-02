import { NextRequest } from 'next/server';
import legacy from '@/lib/handlers/flows/[...path]';
import { adapt } from '@/lib/vercel-next-adapter';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: { path: string[] } };

export async function GET(req: NextRequest, { params }: Ctx) {
  return adapt(req, legacy as any, { path: params.path });
}
export async function POST(req: NextRequest, { params }: Ctx) {
  return adapt(req, legacy as any, { path: params.path });
}
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return adapt(req, legacy as any, { path: params.path });
}
export async function DELETE(req: NextRequest, { params }: Ctx) {
  return adapt(req, legacy as any, { path: params.path });
}
export async function PUT(req: NextRequest, { params }: Ctx) {
  return adapt(req, legacy as any, { path: params.path });
}
