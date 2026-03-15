import { Member, Prisma } from '@prisma/client';
import { GroupWithMembers, SystemWithRelations } from '../types';

export function createMockMember(overrides?: Partial<Member>): Member {
  const defaultMember: Member = {
    id: 'mem-' + Math.random().toString(36).substr(2, 5),
    systemId: 'default-sys-id',
    slug: 'default-member',
    pkId: null,
    name: 'Default Member',
    displayName: null,
    avatarUrl: null,
    pronouns: null,
    description: null,
    color: null,
    proxyTags: [] as unknown as Prisma.JsonValue,
    matrixId: null,
    privacy: {} as unknown as Prisma.JsonValue,
    deviceRegistered: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return { ...defaultMember, ...overrides };
}

export function createMockGroup(overrides?: Partial<GroupWithMembers>): GroupWithMembers {
  const defaultGroup: GroupWithMembers = {
    id: 'group-' + Math.random().toString(36).substr(2, 5),
    systemId: 'default-sys-id',
    slug: 'default-group',
    pkId: null,
    name: 'Default Group',
    displayName: null,
    description: null,
    icon: null,
    color: null,
    privacy: {} as unknown as Prisma.JsonValue,
    createdAt: new Date(),
    updatedAt: new Date(),
    members: [],
  };
  return { ...defaultGroup, ...overrides };
}

export function createMockSystem(overrides?: Partial<SystemWithRelations>): SystemWithRelations {
  const defaultSystem: SystemWithRelations = {
    id: 'default-sys-id',
    slug: 'default-sys',
    pkId: null,
    name: 'Default System',
    description: null,
    pronouns: null,
    avatarUrl: null,
    banner: null,
    color: null,
    systemTag: null,
    autoproxyMode: 'off',
    autoproxyId: null,
    privacy: {} as unknown as Prisma.JsonValue,
    deviceRegistered: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    members: [],
    groups: [],
  };
  return { ...defaultSystem, ...overrides };
}
