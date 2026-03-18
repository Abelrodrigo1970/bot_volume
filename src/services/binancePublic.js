const BASE_URL =
  process.env.BINANCE_TESTNET === "false" || process.env.BINANCE_TESTNET === "0"
    ? "https://fapi.binance.com"
    : "https://testnet.binancefuture.com";

function toNumber(value) {
  return Number.parseFloat(value);
}

/**
 * Fetch exchange info (symbols, filters) from Binance Futures.
 */
export async function fetchExchangeInfo() {
  const url = new URL("/fapi/v1/exchangeInfo", BASE_URL);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Binance exchangeInfo error ${response.status}`);
  }
  return response.json();
}

/**
 * Fetch 24h ticker for all symbols (volume, quoteVolume).
 */
export async function fetch24hTicker() {
  const url = new URL("/fapi/v1/ticker/24hr", BASE_URL);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Binance ticker/24hr error ${response.status}`);
  }
  return response.json();
}

/**
 * Get list of USDT perpetual symbols, up to `limit` (default 500).
 * Filters: contractType PERPETUAL, quoteAsset USDT, status TRADING.
 * @param {number} limit - Max symbols to return
 * @param {string} sortBy - "gain24h" (maior % ganho 24h), "volume" (quoteVolume desc), "symbol" (A–Z), "none" (API order)
 */
export async function getFuturesSymbols(limit = 500, sortBy = "gain24h") {
  const info = await fetchExchangeInfo();
  let symbols = (info.symbols || [])
    .filter(
      (s) =>
        s.contractType === "PERPETUAL" &&
        s.quoteAsset === "USDT" &&
        s.status === "TRADING"
    )
    .map((s) => s.symbol);

  if (sortBy === "gain24h" || sortBy === "volume") {
    const tickers = await fetch24hTicker();
    const withMetric = (tickers || [])
      .filter((t) => t.symbol && symbols.includes(t.symbol))
      .map((t) => ({
        symbol: t.symbol,
        quoteVolume: Number(t.quoteVolume) || 0,
        priceChangePercent: Number(t.priceChangePercent) || 0
      }));
    if (sortBy === "gain24h") {
      withMetric.sort((a, b) => b.priceChangePercent - a.priceChangePercent);
    } else {
      withMetric.sort((a, b) => b.quoteVolume - a.quoteVolume);
    }
    symbols = withMetric.map((t) => t.symbol);
  } else if (sortBy === "symbol") {
    symbols.sort((a, b) => a.localeCompare(b));
  }

  return symbols.slice(0, limit);
}

export async function fetchKlines({ symbol, interval = "1h", limit = 21 }) {
  const url = new URL("/fapi/v1/klines", BASE_URL);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(limit));

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Binance klines error ${response.status}`);
  }

  const data = await response.json();
  return data.map((kline) => ({
    openTime: new Date(kline[0]),
    open: toNumber(kline[1]),
    high: toNumber(kline[2]),
    low: toNumber(kline[3]),
    close: toNumber(kline[4]),
    volume: toNumber(kline[5]),
    closeTime: new Date(kline[6])
  }));
}

export async function fetchMarkPrice(symbol) {
  const url = new URL("/fapi/v1/premiumIndex", BASE_URL);
  url.searchParams.set("symbol", symbol);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Binance premiumIndex error ${response.status}`);
  }

  const data = await response.json();
  return Number.parseFloat(data.markPrice);
}
