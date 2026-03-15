import { applyProxyEffects } from './autoproxyService';
import { PrismaClient } from '@prisma/client';
import { proxyCache } from './cache';
import { emitSystemUpdate } from './events';
import { SystemWithRelations } from '../types';

jest.mock('./cache', () => ({
  proxyCache: { invalidate: jest.fn() },
}));
jest.mock('./events', () => ({
  emitSystemUpdate: jest.fn(),
}));

describe('autoproxyService', () => {
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      system: { update: jest.fn() },
      switch: { create: jest.fn() },
    };
    jest.clearAllMocks();
  });

  it('should latch autoproxyId', async () => {
    const sys = {
      id: 'sys1',
      autoproxyMode: 'latch',
      autoproxyId: 'm1',
      proxyAutoswitch: 'off',
    } as unknown as SystemWithRelations;

    // Triggered by member m2, unproxied
    await applyProxyEffects(sys, 'm2', false, '@alice', mockPrisma as PrismaClient);

    expect(mockPrisma.system.update).toHaveBeenCalledWith({
      where: { id: 'sys1' },
      data: { autoproxyId: 'm2' },
    });
    expect(proxyCache.invalidate).toHaveBeenCalledWith('@alice');
  });

  it('should autoswitch new', async () => {
    const sys = {
      id: 'sys1',
      autoproxyMode: 'off',
      proxyAutoswitch: 'new',
      switches: [{ members: [{ memberId: 'm1' }] }],
    } as unknown as SystemWithRelations;

    await applyProxyEffects(sys, 'm2', true, '@alice', mockPrisma as PrismaClient);

    expect(mockPrisma.switch.create).toHaveBeenCalledWith({
      data: {
        systemId: 'sys1',
        members: { create: [{ memberId: 'm2', order: 0 }] },
      },
    });
  });

  it('should autoswitch add', async () => {
    const sys = {
      id: 'sys1',
      autoproxyMode: 'off',
      proxyAutoswitch: 'add',
      switches: [{ members: [{ memberId: 'm1' }] }],
    } as unknown as SystemWithRelations;

    await applyProxyEffects(sys, 'm2', true, '@alice', mockPrisma as PrismaClient);

    expect(mockPrisma.switch.create).toHaveBeenCalledWith({
      data: {
        systemId: 'sys1',
        members: {
          create: [
            { memberId: 'm1', order: 0 },
            { memberId: 'm2', order: 1 },
          ],
        },
      },
    });
  });
});
