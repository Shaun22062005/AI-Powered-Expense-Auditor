import { z } from 'zod';

export const ClaimCreateSchema = z.object({
  amount: z.number().positive(),
  merchant: z.string().min(1),
  date: z.string(),
  category: z.string(),
  receiptUrl: z.string().url(),
});

export type ClaimCreateInput = z.infer<typeof ClaimCreateSchema>;
