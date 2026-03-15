import { z } from 'zod';

export const MediaUploadSchema = z.object({
  filename: z
    .string()
    .regex(/^[a-zA-Z0-9._-]+$/)
    .max(255)
    .default('upload.png'),
});
