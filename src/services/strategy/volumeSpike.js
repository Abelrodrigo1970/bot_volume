export function generateVolumeSpikeSignal({
  candles,
  volumeWindow,
  spikeMultiplier
}) {
  const required = volumeWindow + 1;
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

  const current = candles[candles.length - 1];
  const previous = candles.slice(-(volumeWindow + 1), -1);
  const avgVolume =
    previous.reduce((sum, candle) => sum + candle.volume, 0) / volumeWindow;

  const spikeRatio = avgVolume > 0 ? current.volume / avgVolume : 0;
  const isSpike = spikeRatio >= spikeMultiplier;
  const bullish = current.close > current.open;

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
    reason: "Spike found but candle is not bullish",
    spikeRatio,
    currentVolume: current.volume,
    averageVolume: avgVolume,
    candleOpen: current.open,
    candleClose: current.close
  };
}
