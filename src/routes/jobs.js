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

export async function registerJobRoutes(app, config) {
  app.post("/jobs/signal", async (request, reply) => {
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

    try {
      const bySymbol = [];
      let openedTrades = 0;
      let exitsCount = 0;
      let signalsCount = 0;

      for (const symbol of symbols) {
        const result = await processSymbol(symbol, config);
        bySymbol.push(result);
        if (result.openedTrade) {
          openedTrades += 1;
        }
        exitsCount += result.exits.length;
        if (result.signal) {
          signalsCount += 1;
        }
      }

      await prisma.jobRun.update({
        where: { id: jobRun.id },
        data: {
          finishedAt: new Date(),
          success: true,
          openedTrades,
          exitsCount,
          signalsCount
        }
      });

      return reply.send({
        ok: true,
        runId: jobRun.id,
        openedTrades,
        exitsCount,
        signalsCount,
        symbols: bySymbol
      });
    } catch (error) {
      await prisma.jobRun.update({
        where: { id: jobRun.id },
        data: {
          finishedAt: new Date(),
          success: false,
          error: error instanceof Error ? error.message : "Unknown error"
        }
      });
      throw error;
    }
  });
}
