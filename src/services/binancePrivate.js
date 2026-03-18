import crypto from "crypto";

const BASE_URL =
  process.env.BINANCE_TESTNET === "false" || process.env.BINANCE_TESTNET === "0"
    ? "https://fapi.binance.com"
    : "https://testnet.binancefuture.com";

const RECV_WINDOW = 10_000;

function sign(secret, queryString) {
  return crypto.createHmac("sha256", secret).update(queryString).digest("hex");
}

let exchangeInfoCache = null;
let exchangeInfoFetchedAt = 0;
const EXCHANGE_INFO_TTL_MS = 10 * 60 * 1000;

async function fetchExchangeInfoCached() {
  const now = Date.now();
  if (exchangeInfoCache && now - exchangeInfoFetchedAt < EXCHANGE_INFO_TTL_MS) {
    return exchangeInfoCache;
  }

  const url = new URL("/fapi/v1/exchangeInfo", BASE_URL);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Binance exchangeInfo error ${response.status}`);
  }
  exchangeInfoCache = await response.json();
  exchangeInfoFetchedAt = now;
  return exchangeInfoCache;
}

function stepSizeToDecimals(stepSizeStr) {
  const s = String(stepSizeStr);
  const dot = s.indexOf(".");
  if (dot === -1) return 0;
  const frac = s.slice(dot + 1).replace(/0+$/, "");
  return Math.max(0, frac.length);
}

function floorToStep(quantity, stepSizeStr) {
  const step = Number(stepSizeStr);
  if (!Number.isFinite(step) || step <= 0) {
    return quantity;
  }
  const floored = Math.floor(quantity / step) * step;
  const decimals = stepSizeToDecimals(stepSizeStr);
  return Number(floored.toFixed(decimals));
}

async function normalizeQuantityForSymbol(symbol, quantity) {
  const info = await fetchExchangeInfoCached();
  const s = (info.symbols || []).find((x) => x.symbol === symbol);
  if (!s) {
    return quantity;
  }
  const lot = (s.filters || []).find((f) => f.filterType === "LOT_SIZE");
  if (lot?.stepSize) {
    return floorToStep(quantity, lot.stepSize);
  }
  if (Number.isInteger(s.quantityPrecision)) {
    const p = Math.max(0, s.quantityPrecision);
    const factor = 10 ** p;
    return Math.floor(quantity * factor) / factor;
  }
  return quantity;
}

/**
 * Place a MARKET order on Binance Futures (USDT-M).
 * @param {object} opts - { apiKey, apiSecret, symbol, side: 'BUY'|'SELL', quantity, reduceOnly?: boolean }
 * @returns {Promise<object>} Order response from Binance
 */
export async function placeMarketOrder({
  apiKey,
  apiSecret,
  symbol,
  side,
  quantity,
  reduceOnly = false
}) {
  const qty = await normalizeQuantityForSymbol(symbol, quantity);
  if (qty <= 0) {
    throw new Error("Quantity must be positive");
  }

  const params = new URLSearchParams({
    symbol,
    side,
    type: "MARKET",
    quantity: String(qty),
    timestamp: String(Date.now()),
    recvWindow: String(RECV_WINDOW)
  });
  if (reduceOnly) {
    params.set("reduceOnly", "true");
  }

  const queryString = params.toString();
  const signature = sign(apiSecret, queryString);

  const url = `${BASE_URL}/fapi/v1/order?${queryString}&signature=${signature}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-MBX-APIKEY": apiKey,
      "Content-Type": "application/x-www-form-urlencoded"
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = data.msg || data.message || response.statusText;
    throw new Error(`Binance order error: ${msg} (code ${data.code ?? response.status})`);
  }
  return data;
}
