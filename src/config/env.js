import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  SYMBOLS: z.string().default("BTCUSDT"),
  USE_DYNAMIC_SYMBOLS: z
    .string()
    .transform((v) => v === "true" || v === "1")
    .default("true"),
  SYMBOL_LIMIT: z.coerce.number().int().min(1).max(1000).default(500),
  INTERVAL: z.string().default("1h"),
  VOLUME_WINDOW: z.coerce.number().int().positive().default(20),
  SPIKE_MULTIPLIER: z.coerce.number().positive().default(6),
  BUY_NOTIONAL_USD: z.coerce.number().positive().default(100),
  TP1_PCT: z.coerce.number().positive().default(9),
  TP1_SELL_PCT: z.coerce.number().positive().max(100).default(35),
  TP2_PCT: z.coerce.number().positive().default(25),
  TP2_SELL_PCT: z.coerce.number().positive().max(100).default(35),
  FORCE_EXIT_HOURS: z.coerce.number().int().positive().default(24),
  CRON_TOKEN: z.string().min(1),
  BINANCE_API_KEY: z.string().optional(),
  BINANCE_API_SECRET: z.string().optional(),
  BINANCE_TESTNET: z
    .string()
    .transform((v) => v !== "false" && v !== "0")
    .default("true")
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

const binanceBaseUrl =
  env.BINANCE_TESTNET === false
    ? "https://fapi.binance.com"
    : "https://testnet.binancefuture.com";

export const config = {
  ...env,
  useDynamicSymbols: env.USE_DYNAMIC_SYMBOLS,
  symbolLimit: env.SYMBOL_LIMIT,
  binanceBaseUrl,
  binanceTradingEnabled:
    Boolean(env.BINANCE_API_KEY) && Boolean(env.BINANCE_API_SECRET),
  symbols: env.SYMBOLS.split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)
};
