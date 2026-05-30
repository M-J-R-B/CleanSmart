import "dotenv/config";
import * as Sentry from "@sentry/node";
import { parseEnv } from "@cleansmart/shared";
import { buildApp } from "./app";

const env = parseEnv(process.env);

if (env.SENTRY_DSN) {
  Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV, tracesSampleRate: 0.1 });
}

const app = buildApp();

app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
