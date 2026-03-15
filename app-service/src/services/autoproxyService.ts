import { PrismaClient } from '@prisma/client';
import { proxyCache } from './cache';
import { emitSystemUpdate } from './events';
import { SystemWithRelations } from '../types';

/**
 * Applies the autoproxy latch and proxy autoswitch effects.
 *
 * This is the single source of truth for post-proxy side effects, shared between the
 * gatekeeper (unencrypted path) and bot.ts (E2EE path).
 */
export async function applyProxyEffects(
  system: SystemWithRelations,
  targetMemberId: string,
  wasAutoproxied: boolean,
  sender: string,
  prismaClient: PrismaClient,
): Promise<void> {
  let cacheInvalidated = false;

  try {
    // 1. Autoproxy Latch
    if (system.autoproxyMode === 'latch' && !wasAutoproxied && system.autoproxyId !== targetMemberId) {
      await prismaClient.system.update({
        where: { id: system.id },
        data: { autoproxyId: targetMemberId },
      });
      cacheInvalidated = true;
    }

    // 2. Proxy Autoswitch
    if (system.proxyAutoswitch === 'new' || system.proxyAutoswitch === 'add') {
      const latestSwitch = system.switches?.[0];
      const currentFront: string[] = latestSwitch ? latestSwitch.members.map((sm) => sm.memberId) : [];

      if (system.proxyAutoswitch === 'new') {
        // If 'new', we log a switch with JUST this member, unless they are ALREADY the ONLY member fronting.
        if (currentFront.length !== 1 || currentFront[0] !== targetMemberId) {
          await prismaClient.switch.create({
            data: {
              systemId: system.id,
              members: {
                create: [{ memberId: targetMemberId, order: 0 }],
              },
            },
          });
          cacheInvalidated = true;
        }
      } else if (system.proxyAutoswitch === 'add') {
        // If 'add', we append this member to the existing front, unless they are already there.
        if (!currentFront.includes(targetMemberId)) {
          const newFront = [...currentFront, targetMemberId];
          await prismaClient.switch.create({
            data: {
              systemId: system.id,
              members: {
                create: newFront.map((memberId, idx) => ({ memberId, order: idx })),
              },
            },
          });
          cacheInvalidated = true;
        }
      }
    }

    if (cacheInvalidated) {
      proxyCache.invalidate(sender);
      emitSystemUpdate(sender);
    }
  } catch (e) {
    console.error('[AutoProxy/AutoSwitch] Failed to apply proxy effects:', e);
  }
}
