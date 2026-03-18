export function generateVolumeSpikeSignal({
  candles,
  volumeWindow,
  spikeMultiplier,
  maPeriods = 200
}) {
  // Use only closed candles: last in API is often still open; we use penultimate as "current"
  const requiredVolume = volumeWindow + 2;
  const requiredMa = maPeriods + 2;
  const required = Math.max(requiredVolume, requiredMa);
  if (!candles || candles.length < required) {
    return {
      side: "NO_SIGNAL",
      reason: "Not enough candles",
      spikeRatio: 0,
      currentVolume: 0,
      averageVolume: 0,
      candleOpen: 0,
      candleClose: 0
    };
  }

  const lastClosedIndex = candles.length - 2;
  const current = candles[lastClosedIndex];
  const previous = candles.slice(-(volumeWindow + 2), -2);
  const avgVolume =
    previous.reduce((sum, candle) => sum + candle.volume, 0) / volumeWindow;

  const spikeRatio = avgVolume > 0 ? current.volume / avgVolume : 0;
  const isSpike = spikeRatio >= spikeMultiplier;
  const bullish = current.close > current.open;

  const maCandles = candles.slice(-(maPeriods + 2), -2);
  const smaClose =
    maCandles.length >= maPeriods
      ? maCandles.reduce((sum, c) => sum + c.close, 0) / maPeriods
      : null;
  const aboveMa = smaClose !== null && current.close > smaClose;

  if (isSpike && bullish) {
    return {
      side: "LONG",
      reason: `Spike ${spikeRatio.toFixed(2)}x with bullish candle`,
      spikeRatio,
      currentVolume: current.volume,
      averageVolume: avgVolume,
      candleOpen: current.open,
      candleClose: current.close
    };
  }

  if (isSpike && !bullish && aboveMa) {
    return {
      side: "LONG",
      reason: `Spike ${spikeRatio.toFixed(2)}x, vela bear mas close acima MA(${maPeriods})`,
      spikeRatio,
      currentVolume: current.volume,
      averageVolume: avgVolume,
      candleOpen: current.open,
      candleClose: current.close
    };
  }

  if (!isSpike) {
    return {
      side: "NO_SIGNAL",
      reason: `Spike ${spikeRatio.toFixed(2)}x below ${spikeMultiplier}x`,
      spikeRatio,
      currentVolume: current.volume,
      averageVolume: avgVolume,
      candleOpen: current.open,
      candleClose: current.close
    };
  }

  return {
    side: "NO_SIGNAL",
    reason: "Spike found but candle not bullish and close below MA",
    spikeRatio,
    currentVolume: current.volume,
    averageVolume: avgVolume,
    candleOpen: current.open,
    candleClose: current.close
  };
}
