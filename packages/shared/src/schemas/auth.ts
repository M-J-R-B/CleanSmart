import { z } from "zod";

export const RoleSchema = z.enum(["client", "worker", "admin"]);
export type Role = z.infer<typeof RoleSchema>;

const PhoneSchema = z.string().regex(/^\+[1-9]\d{6,14}$/, "Phone must be E.164 format");

export const OtpRequestSchema = z.object({
  phone: PhoneSchema,
});
export type OtpRequest = z.infer<typeof OtpRequestSchema>;

export const OtpVerifySchema = z.object({
  phone: PhoneSchema,
  code: z.string().regex(/^\d{6}$/, "OTP must be 6 digits"),
  role: RoleSchema.exclude(["admin"]),
  name: z.string().min(1).max(80).optional(),
});
export type OtpVerify = z.infer<typeof OtpVerifySchema>;

export const RefreshSchema = z.object({
  refreshToken: z.string().min(20),
});
export type RefreshRequest = z.infer<typeof RefreshSchema>;
