import { randomBytes, createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import type { PrismaClient } from "@cleansmart/db";
import type { Role } from "@cleansmart/shared";

export interface TokenConfig {
  accessSecret: string;
  refreshSecret: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

export interface AccessClaims {
  sub: string;
  role: Role;
  iat: number;
  exp: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createTokenService(prisma: PrismaClient, cfg: TokenConfig) {
  return {
    async issuePair(userId: string, role: Role): Promise<TokenPair> {
      const accessToken = jwt.sign({ sub: userId, role }, cfg.accessSecret, {
        expiresIn: cfg.accessTtlSeconds,
      });
      const refreshToken = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + cfg.refreshTtlSeconds * 1000);
      await prisma.refreshToken.create({
        data: { userId, tokenHash: hashToken(refreshToken), expiresAt },
      });
      return {
        accessToken,
        refreshToken,
        accessExpiresAt: Math.floor(Date.now() / 1000) + cfg.accessTtlSeconds,
        refreshExpiresAt: Math.floor(expiresAt.getTime() / 1000),
      };
    },

    verifyAccess(token: string): AccessClaims {
      return jwt.verify(token, cfg.accessSecret) as AccessClaims;
    },

    async rotateRefresh(refreshToken: string): Promise<TokenPair> {
      const tokenHash = hashToken(refreshToken);
      const row = await prisma.refreshToken.findFirst({ where: { tokenHash } });
      if (!row) throw new Error("refresh token invalid");
      if (row.revokedAt) throw new Error("refresh token revoked");
      if (row.expiresAt < new Date()) throw new Error("refresh token expired");
      await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
      const user = await prisma.user.findUniqueOrThrow({ where: { id: row.userId } });
      return this.issuePair(user.id, user.role as Role);
    },

    async revokeRefresh(refreshToken: string): Promise<void> {
      const tokenHash = hashToken(refreshToken);
      await prisma.refreshToken.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },

    async revokeAllForUser(userId: string): Promise<void> {
      await prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },
  };
}

export type TokenService = ReturnType<typeof createTokenService>;
