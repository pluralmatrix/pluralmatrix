import { MemberSchema } from './app-service/src/schemas/member';
console.log(MemberSchema.partial().parse({
  privacy: { description_privacy: 'private' }
}));