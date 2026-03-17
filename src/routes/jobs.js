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

async function runJobInBackground(jobRunId, symbols, config) {
  try {
    const bySymbol = [];
    let openedTrades = 0;
    let exitsCount = 0;
    let signalsCount = 0;

    for (const symbol of symbols) {
      const result = await processSymbol(symbol, config);
      bySymbol.push(result);
      if (result.openedTrade) openedTrades += 1;
      exitsCount += result.exits.length;
      if (result.signal) signalsCount += 1;
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
  } catch (error) {
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

async function handleJobsSignal(request, reply, config) {
  const token = getCronTokenFromRequest(request);
  if (token !== config.CRON_TOKEN) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  const symbols = config.useDynamicSymbols
    ? await getFuturesSymbols(config.symbolLimit)
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

  runJobInBackground(jobRun.id, symbols, config);

  return reply.send({
    ok: true,
    message: `Job started in background (${symbols.length} symbols)`,
    runId: jobRun.id
  });
}

export async function registerJobRoutes(app, config) {
  const handler = (request, reply) => handleJobsSignal(request, reply, config);
  app.get("/jobs/signal", handler);
  app.post("/jobs/signal", handler);
}
