import crypto from "crypto";

const BASE_URL =
  process.env.BINANCE_TESTNET === "false" || process.env.BINANCE_TESTNET === "0"
    ? "https://fapi.binance.com"
    : "https://testnet.binancefuture.com";

const RECV_WINDOW = 10_000;

function sign(secret, queryString) {
  return crypto.createHmac("sha256", secret).update(queryString).digest("hex");
}

/**
 * Round quantity to avoid Binance LOT_SIZE error (simple 6 decimals).
 */
function roundQuantity(qty) {
  return Math.floor(qty * 1e6) / 1e6;
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
  const qty = roundQuantity(quantity);
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
