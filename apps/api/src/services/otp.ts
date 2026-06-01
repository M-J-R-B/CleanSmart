import type IORedis from "ioredis";
import type { Twilio } from "twilio";

export interface OtpService {
  send(phone: string): Promise<void>;
  verify(phone: string, code: string): Promise<boolean>;
}

const RATE_LIMIT_PER_HOUR = 5;

export function createOtpService(twilio: Twilio, redis: IORedis, verifyServiceSid: string): OtpService {
  return {
    async send(phone) {
      const key = `otp:send:${phone}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 60 * 60);
      if (count > RATE_LIMIT_PER_HOUR) throw new Error("OTP rate limit exceeded");
      await twilio.verify.v2.services(verifyServiceSid).verifications.create({ to: phone, channel: "sms" });
    },
    async verify(phone, code) {
      const result = await twilio.verify
        .v2.services(verifyServiceSid)
        .verificationChecks.create({ to: phone, code });
      const ok = result.status === "approved";
      if (ok) await redis.del(`otp:send:${phone}`);
      return ok;
    },
  };
}
