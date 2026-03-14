import { System, Member, Group } from '@prisma/client';

export type GroupWithMembers = Group & { members: Member[] };
export type SystemWithRelations = System & {
    members: Member[];
    groups: GroupWithMembers[];
};
