import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyPersonaSignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=")));
  const candidate = parts["v1"];
  if (!candidate) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface PersonaInquiryEvent {
  inquiryId: string;
  status: "completed" | "failed" | "expired" | string;
  eventName: string;
}

export function parsePersonaEvent(body: any): PersonaInquiryEvent | null {
  const attrs = body?.data?.attributes;
  if (!attrs) return null;
  const inner = attrs.payload?.data;
  if (!inner) return null;
  return {
    inquiryId: inner.id,
    status: inner.attributes?.status,
    eventName: attrs.name,
  };
}
