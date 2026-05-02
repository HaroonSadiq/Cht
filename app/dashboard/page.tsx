// /dashboard — Server Component (phase 3 of Next.js migration).
//
// Solves the "data dependency compromised / flicker" problem by
// fetching the user's session, workspace, and contact count on the
// server using the existing Prisma db client, then embedding the
// result as window.__BOOT__ in the rendered HTML. The legacy
// dashboard JS reads __BOOT__ first and only falls back to
// /api/auth/me if it's missing.
//
// The dashboard markup itself still reads from dashboard.html for
// now (same pragmatic shortcut as the landing). The inline <script>
// from the legacy file is preserved unchanged so all the rule
// builder, integration list, profile dropdown, and inbox logic
// keeps working as-is.

import { cookies } from 'next/headers';
import { jwtVerify } from 'jose';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { db } from '@/lib/db';

const file = readFileSync(path.join(process.cwd(), 'dashboard.html'), 'utf-8');
const styleMatch = file.match(/<style[^>]*>([\s\S]*?)<\/style>/);
const bodyMatch  = file.match(/<body[^>]*>([\s\S]*)<\/body>/);
const STYLE = styleMatch?.[1] ?? '';
// Keep the original <script> block — the browser will run it from the
// SSR'd HTML stream, picking up window.__BOOT__ that we set just above.
const BODY = bodyMatch?.[1] ?? '';

// Force per-request rendering — boot data is user-specific.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type BootData = {
  user: { id: string; email: string; name: string | null; createdAt: string };
  workspace: {
    id: string; slug: string; name: string;
    created_at: string;
    counts: { integrations: number; tags: number };
  } | null;
  contactsCount: number;
} | null;

async function getBootData(): Promise<BootData> {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;

  const session = cookies().get('fb_session')?.value;
  if (!session) return null;

  let userId: string;
  try {
    const { payload } = await jwtVerify(session, new TextEncoder().encode(secret));
    userId = String(payload.sub);
  } catch {
    return null;
  }

  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, createdAt: true },
    });
    if (!user) return null;

    const workspace = await db.workspace.findFirst({
      where: { ownerId: user.id },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { connectedAccounts: true, tags: true } } },
    });

    const contactsCount = workspace
      ? await db.contact.count({
          where: { connectedAccount: { workspace: { ownerId: userId } } },
        })
      : 0;

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt.toISOString(),
      },
      workspace: workspace
        ? {
            id: workspace.id,
            slug: workspace.slug,
            name: workspace.name,
            created_at: workspace.createdAt.toISOString(),
            counts: {
              integrations: workspace._count.connectedAccounts,
              tags: workspace._count.tags,
            },
          }
        : null,
      contactsCount,
    };
  } catch {
    // Database unreachable — fall back to client-side fetch.
    return null;
  }
}

export const metadata = {
  title: 'FlowBot · Comment-to-DM Dashboard',
};

export default async function DashboardPage() {
  const boot = await getBootData();

  // Embed boot data as a script that runs before the legacy dashboard
  // JS, so window.__BOOT__ is available when boot() reads it. We only
  // emit the script when we actually have data — otherwise the legacy
  // path (fetch /api/auth/me, show signin overlay if 401) takes over.
  const bootScript = boot
    ? `<script>window.__BOOT__ = ${JSON.stringify(boot).replace(/</g, '\\u003c')};</script>`
    : '';

  // Concat the boot script into the body before rendering. The browser
  // parses scripts in document order, so __BOOT__ is set before the
  // dashboard's main inline script runs.
  const bodyWithBoot = bootScript + BODY;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <div dangerouslySetInnerHTML={{ __html: bodyWithBoot }} />
    </>
  );
}
