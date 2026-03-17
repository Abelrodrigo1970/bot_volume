const BASE_URL = "https://fapi.binance.com";

function toNumber(value) {
  return Number.parseFloat(value);
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
