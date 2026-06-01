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

export interface PersonaClient {
  createInquiry(referenceId: string): Promise<{ inquiryId: string; sessionToken: string }>;
}

export function createPersonaClient(apiKey: string, templateId: string): PersonaClient {
  return {
    async createInquiry(referenceId) {
      const res = await fetch("https://withpersona.com/api/v1/inquiries", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "persona-version": "2023-01-05",
        },
        body: JSON.stringify({
          data: { attributes: { "inquiry-template-id": templateId, "reference-id": referenceId } },
        }),
      });
      if (!res.ok) throw new Error(`Persona inquiry failed: ${res.status}`);
      const json = (await res.json()) as { data: { id: string; attributes: { "session-token": string } } };
      return { inquiryId: json.data.id, sessionToken: json.data.attributes["session-token"] };
    },
  };
}
