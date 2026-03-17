import { prisma } from "../db/client.js";
import { fetchKlines, fetchMarkPrice } from "./binancePublic.js";
import { placeMarketOrder } from "./binancePrivate.js";
import { generateVolumeSpikeSignal } from "./strategy/volumeSpike.js";

function hoursBetween(a, b) {
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60);
}

function pnlLong(entryPrice, exitPrice, quantity) {
  return (exitPrice - entryPrice) * quantity;
}

export async function processSymbol(symbol, config) {
  const result = {
    symbol,
    signal: null,
    openedTrade: false,
    exits: []
  };

  const openTrades = await prisma.trade.findMany({
    where: { symbol, status: "OPEN" },
    orderBy: { openedAt: "asc" }
  });

  if (openTrades.length > 0) {
    const currentPrice = await fetchMarkPrice(symbol);
    for (const trade of openTrades) {
      const tradeExits = await maybeExecuteExits(trade, currentPrice, config);
      result.exits.push(...tradeExits);
    }
  }

  const hasOpenTrade = await prisma.trade.count({
    where: { symbol, status: "OPEN" }
  });
  if (hasOpenTrade > 0) {
    return result;
  }

  const candles = await fetchKlines({
    symbol,
    interval: config.INTERVAL,
    limit: config.VOLUME_WINDOW + 1
  });

  const signalData = generateVolumeSpikeSignal({
    candles,
    volumeWindow: config.VOLUME_WINDOW,
    spikeMultiplier: config.SPIKE_MULTIPLIER
  });

  const signal = await prisma.signal.create({
    data: {
      symbol,
      side: signalData.side,
      interval: config.INTERVAL,
      spikeRatio: signalData.spikeRatio,
      currentVolume: signalData.currentVolume,
      averageVolume: signalData.averageVolume,
      candleOpen: signalData.candleOpen,
      candleClose: signalData.candleClose,
      reason: signalData.reason
    }
  });
  result.signal = signal;

  if (signalData.side !== "LONG") {
    return result;
  }

  const entryPrice = candles[candles.length - 1].close;
  const quantity = config.BUY_NOTIONAL_USD / entryPrice;

  if (config.binanceTradingEnabled) {
    try {
      await placeMarketOrder({
        apiKey: config.BINANCE_API_KEY,
        apiSecret: config.BINANCE_API_SECRET,
        symbol,
        side: "BUY",
        quantity
      });
    } catch (err) {
      result.binanceOrderError = err.message;
      return result;
    }
  }

  await prisma.trade.create({
    data: {
      signalId: signal.id,
      symbol,
      status: "OPEN",
      entryPrice,
      quantity,
      remainingQty: quantity,
      notionalUsd: config.BUY_NOTIONAL_USD,
      openedAt: new Date()
    }
  });
  result.openedTrade = true;

  return result;
}

async function maybeExecuteExits(trade, currentPrice, config) {
  const exits = [];
  let remainingQty = trade.remainingQty;
  let realizedPnlUsd = trade.realizedPnlUsd;
  const now = new Date();

  if (!trade.tp1ExecutedAt) {
    const tp1Target = trade.entryPrice * (1 + config.TP1_PCT / 100);
    if (currentPrice >= tp1Target && remainingQty > 0) {
      const qty = trade.quantity * (config.TP1_SELL_PCT / 100);
      const safeQty = Math.min(qty, remainingQty);
      const pnlUsd = pnlLong(trade.entryPrice, currentPrice, safeQty);
      remainingQty -= safeQty;
      realizedPnlUsd += pnlUsd;
      exits.push({
        reason: "TP1",
        price: currentPrice,
        quantity: safeQty,
        pnlUsd,
        gainPct: ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100,
        executedAt: now
      });
    }
  }

  if (!trade.tp2ExecutedAt) {
    const tp2Target = trade.entryPrice * (1 + config.TP2_PCT / 100);
    if (currentPrice >= tp2Target && remainingQty > 0) {
      const qty = trade.quantity * (config.TP2_SELL_PCT / 100);
      const safeQty = Math.min(qty, remainingQty);
      const pnlUsd = pnlLong(trade.entryPrice, currentPrice, safeQty);
      remainingQty -= safeQty;
      realizedPnlUsd += pnlUsd;
      exits.push({
        reason: "TP2",
        price: currentPrice,
        quantity: safeQty,
        pnlUsd,
        gainPct: ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100,
        executedAt: now
      });
    }
  }

  const ageHours = hoursBetween(trade.openedAt, now);
  if (ageHours >= config.FORCE_EXIT_HOURS && remainingQty > 0) {
    const pnlUsd = pnlLong(trade.entryPrice, currentPrice, remainingQty);
    realizedPnlUsd += pnlUsd;
    exits.push({
      reason: "TIME_EXIT",
      price: currentPrice,
      quantity: remainingQty,
      pnlUsd,
      gainPct: ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100,
      executedAt: now
    });
    remainingQty = 0;
  }

  if (exits.length === 0) {
    return [];
  }

  if (config.binanceTradingEnabled) {
    for (const exit of exits) {
      await placeMarketOrder({
        apiKey: config.BINANCE_API_KEY,
        apiSecret: config.BINANCE_API_SECRET,
        symbol: trade.symbol,
        side: "SELL",
        quantity: exit.quantity,
        reduceOnly: true
      });
    }
  }

  const firstTp1 = exits.find((exit) => exit.reason === "TP1");
  const firstTp2 = exits.find((exit) => exit.reason === "TP2");
  const hasTimeExit = exits.some((exit) => exit.reason === "TIME_EXIT");
  const closed = remainingQty <= 1e-12;

  await prisma.$transaction([
    prisma.tradeExit.createMany({
      data: exits.map((exit) => ({
        tradeId: trade.id,
        reason: exit.reason,
        price: exit.price,
        quantity: exit.quantity,
        pnlUsd: exit.pnlUsd,
        gainPct: exit.gainPct,
        executedAt: exit.executedAt
      }))
    }),
    prisma.trade.update({
      where: { id: trade.id },
      data: {
        remainingQty,
        realizedPnlUsd,
        tp1ExecutedAt: firstTp1 ? firstTp1.executedAt : trade.tp1ExecutedAt,
        tp2ExecutedAt: firstTp2 ? firstTp2.executedAt : trade.tp2ExecutedAt,
        timeExitExecuted: hasTimeExit || trade.timeExitExecuted,
        status: closed ? "CLOSED" : trade.status,
        closedAt: closed ? now : trade.closedAt
      }
    })
  ]);

  return exits;
}
