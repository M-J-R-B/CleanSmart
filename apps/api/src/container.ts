import IORedis from "ioredis";
import twilio from "twilio";
import { getPrisma, type PrismaClient } from "@cleansmart/db";
import { parseEnv, type Env } from "@cleansmart/shared";
import { createOtpService, type OtpService } from "./services/otp";
import { createTokenService, type TokenService } from "./services/tokens";

export interface Container {
  env: Env;
  prisma: PrismaClient;
  redis: IORedis;
  otp: OtpService;
  tokens: TokenService;
}

export function buildContainer(env: Env = parseEnv(process.env)): Container {
  const prisma = getPrisma();
  const redis = new IORedis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: null });
  const tw = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  const otp = createOtpService(tw, redis, env.TWILIO_VERIFY_SERVICE_SID);
  const tokens = createTokenService(prisma, {
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
    refreshTtlSeconds: env.REFRESH_TOKEN_TTL_SECONDS,
  });
  return { env, prisma, redis, otp, tokens };
}
