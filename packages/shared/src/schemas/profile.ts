import { z } from "zod";

export const UpdateMeSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  avatarUrl: z.string().url().optional(),
});
export type UpdateMe = z.infer<typeof UpdateMeSchema>;

export const UpdateWorkerSchema = z.object({
  bio: z.string().max(1000).optional(),
  serviceRadiusKm: z.number().int().min(1).max(100).optional(),
  homeLat: z.number().gte(-90).lte(90).optional(),
  homeLng: z.number().gte(-180).lte(180).optional(),
});
export type UpdateWorker = z.infer<typeof UpdateWorkerSchema>;

export const UpdateClientSchema = z.object({
  defaultAddress: z.string().max(300).optional(),
});
export type UpdateClient = z.infer<typeof UpdateClientSchema>;
