import { z } from 'zod';

export const LoginSchema = z.object({
  mxid: z.string().min(1).max(255),
  password: z.string().min(1).max(1024),
});
