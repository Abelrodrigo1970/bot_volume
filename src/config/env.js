import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  SYMBOLS: z.string().default("BTCUSDT"),
  INTERVAL: z.string().default("1h"),
  VOLUME_WINDOW: z.coerce.number().int().positive().default(20),
  SPIKE_MULTIPLIER: z.coerce.number().positive().default(6),
  BUY_NOTIONAL_USD: z.coerce.number().positive().default(100),
  TP1_PCT: z.coerce.number().positive().default(9),
  TP1_SELL_PCT: z.coerce.number().positive().max(100).default(35),
  TP2_PCT: z.coerce.number().positive().default(25),
  TP2_SELL_PCT: z.coerce.number().positive().max(100).default(35),
  FORCE_EXIT_HOURS: z.coerce.number().int().positive().default(24),
  CRON_TOKEN: z.string().min(1)
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables");
}

const env = parsed.data;

if (env.TP1_SELL_PCT + env.TP2_SELL_PCT >= 100) {
  throw new Error("TP sell percentages must leave remaining quantity > 0");
}

export const config = {
  ...env,
  symbols: env.SYMBOLS.split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)
};
