// Tenancy guards — every flow + keyword + message lives strictly inside
// one connected_account, which lives strictly inside one workspace.
// Two clients can use the same keyword on different pages; no leak possible.
//
// These helpers centralize that rule so endpoints don't reinvent it.

import { db } from './db';

export type TenantedAccount = {
  id: string;
  workspaceId: string;
  ownerId: string;
  platform: 'facebook' | 'instagram' | 'messenger' | 'tiktok' | 'tiktok_shop';
  platformAccountId: string;
  displayName: string | null;
};

// Resolve a connected_account ONLY if it belongs to the calling user.
// Returns null if the user doesn't own this integration — never throws,
// so callers can map to a 404 cleanly.
export async function resolveOwnedAccount(opts: {
  userId: string;
  connectedAccountId: string;
}): Promise<TenantedAccount | null> {
  const a = await db.connectedAccount.findFirst({
    where: { id: opts.connectedAccountId, workspace: { ownerId: opts.userId } },
    include: { workspace: true },
  });
  if (!a) return null;
  return {
    id: a.id,
    workspaceId: a.workspaceId,
    ownerId: a.workspace.ownerId,
    platform: a.platform,
    platformAccountId: a.platformAccountId,
    displayName: a.displayName,
  };
}

// Normalize a list of raw keyword strings the way the dispatcher matches them:
// trimmed, lowercased, whitespace collapsed, deduped.
export function normalizeKeywords(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const k = raw.trim().toLowerCase().replace(/\s+/g, ' ');
    if (k) seen.add(k);
  }
  return Array.from(seen);
}

// Find any ACTIVE flow on the same connected_account that already claims
// any of the given keywords. Used to prevent two flows from competing.
// Pass `excludeFlowId` when updating an existing flow so it doesn't conflict with itself.
export async function findKeywordConflicts(opts: {
  connectedAccountId: string;
  keywords: string[];
  excludeFlowId?: string;
}): Promise<Array<{ flowId: string; name: string; conflictingKeywords: string[] }>> {
  if (!opts.keywords.length) return [];

  const candidates = await db.flow.findMany({
    where: {
      connectedAccountId: opts.connectedAccountId,
      isActive: true,
      keywords: { hasSome: opts.keywords },
      ...(opts.excludeFlowId && { NOT: { id: opts.excludeFlowId } }),
    },
    select: { id: true, name: true, keywords: true },
  });

  return candidates.map((c) => ({
    flowId: c.id,
    name: c.name,
    conflictingKeywords: c.keywords.filter((k) => opts.keywords.includes(k)),
  }));
}
