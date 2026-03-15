import { PrismaClient } from '@prisma/client';
import { proxyCache } from './cache';
import { emitSystemUpdate } from './events';

interface LatchableSystem {
  id: string;
  autoproxyId: string | null;
  autoproxyMode: string;
}

/**
 * Applies the autoproxy latch: if the system is in latch mode and the message
 * was explicitly tagged (not auto-proxied), updates the active autoproxy member
 * in the DB, invalidates the proxy cache, and notifies connected dashboard clients.
 *
 * This is the single source of truth for latch logic, shared between the
 * gatekeeper (unencrypted path) and bot.ts (E2EE path).
 */
export async function applyAutoproxyLatch(
  system: LatchableSystem,
  targetMemberId: string,
  wasAutoproxied: boolean,
  sender: string,
  prismaClient: PrismaClient,
): Promise<void> {
  if (system.autoproxyMode !== 'latch' || wasAutoproxied) return;
  if (system.autoproxyId === targetMemberId) return;

  try {
    await prismaClient.system.update({
      where: { id: system.id },
      data: { autoproxyId: targetMemberId },
    });
    proxyCache.invalidate(sender);
    emitSystemUpdate(sender);
  } catch (e) {
    console.error('[AutoProxy] Failed to latch:', e);
  }
}
