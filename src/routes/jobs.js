import { prisma } from "../db/client.js";
import { processSymbol } from "../services/tradingEngine.js";
import { getFuturesSymbols } from "../services/binancePublic.js";

function getCronTokenFromRequest(request) {
  const header = request.headers["x-cron-token"];
  if (!header) {
    return "";
  }
  return Array.isArray(header) ? header[0] : header;
}

async function runJobInBackground(jobRunId, symbols, config, log) {
  const total = symbols.length;
  log.info({ jobRunId, total }, `[jobs/signal] Início da busca em ${total} símbolos`);

  try {
    const bySymbol = [];
    let openedTrades = 0;
    let exitsCount = 0;
    let signalsCount = 0;
    const logEvery = Math.max(1, Math.floor(total / 10));

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      const result = await processSymbol(symbol, config);
      bySymbol.push(result);
      if (result.openedTrade) {
        openedTrades += 1;
        log.info({ symbol, jobRunId }, `[jobs/signal] Trade aberto: ${symbol}`);
      }
      exitsCount += result.exits.length;
      if (result.signal?.side === "LONG") signalsCount += 1;
      if (result.binanceOrderError) {
        log.warn({ symbol, error: result.binanceOrderError }, `[jobs/signal] Erro ordem Binance: ${symbol}`);
      }

      const done = i + 1;
      if (done % logEvery === 0 || done === total) {
        log.info({ jobRunId, done, total }, `[jobs/signal] Busca: ${done}/${total} símbolos`);
      }
    }

    await prisma.jobRun.update({
      where: { id: jobRunId },
      data: {
        finishedAt: new Date(),
        success: true,
        openedTrades,
        exitsCount,
        signalsCount
      }
    });

    log.info(
      { jobRunId, openedTrades, exitsCount, signalsCount },
      `[jobs/signal] Fim da busca: ${openedTrades} trades abertos, ${exitsCount} saídas, ${signalsCount} sinais`
    );
  } catch (error) {
    log.error({ err: error, jobRunId }, `[jobs/signal] Erro na busca: ${error?.message}`);
    await prisma.jobRun
      .update({
        where: { id: jobRunId },
        data: {
          finishedAt: new Date(),
          success: false,
          error: error instanceof Error ? error.message : "Unknown error"
        }
      })
      .catch(() => {});
  }
}

async function handleJobsSignal(request, reply, config, log) {
  const token = getCronTokenFromRequest(request);
  if (token !== config.CRON_TOKEN) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  const symbols = config.useDynamicSymbols
    ? await getFuturesSymbols(config.symbolLimit, config.symbolSort)
    : config.symbols;

  const jobRun = await prisma.jobRun.create({
    data: {
      source: "cron-job.org",
      symbols:
        symbols.length > 100
          ? `dynamic (${symbols.length} symbols)`
          : symbols.join(",")
    }
  });

  runJobInBackground(jobRun.id, symbols, config, log);

  return reply.send({
    ok: true,
    message: `Job started in background (${symbols.length} symbols)`,
    runId: jobRun.id
  });
}

export async function startSignalJob(config, log) {
  const symbols = config.useDynamicSymbols
    ? await getFuturesSymbols(config.symbolLimit, config.symbolSort)
    : config.symbols;

  const jobRun = await prisma.jobRun.create({
    data: {
      source: "dashboard",
      symbols:
        symbols.length > 100
          ? `dynamic (${symbols.length} symbols)`
          : symbols.join(",")
    }
  });

  runJobInBackground(jobRun.id, symbols, config, log);

  return {
    ok: true,
    message: `Procura iniciada em background (${symbols.length} símbolos)`,
    runId: jobRun.id
  };
}

export async function registerJobRoutes(app, config) {
  const handler = (request, reply) =>
    handleJobsSignal(request, reply, config, app.log);
  app.get("/jobs/signal", handler);
  app.post("/jobs/signal", handler);
}
