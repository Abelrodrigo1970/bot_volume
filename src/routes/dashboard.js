import { prisma } from "../db/client.js";

function pct(win, total) {
  if (total === 0) {
    return 0;
  }
  return (win / total) * 100;
}

function currency(value) {
  return Number(value).toFixed(2);
}

export async function registerDashboardRoutes(app) {
  app.get("/dashboard/stats", async () => {
    const [totalTrades, openTrades, closedTrades, exits, jobRuns] =
      await Promise.all([
        prisma.trade.count(),
        prisma.trade.count({ where: { status: "OPEN" } }),
        prisma.trade.findMany({ where: { status: "CLOSED" } }),
        prisma.tradeExit.findMany(),
        prisma.jobRun.findMany({
          orderBy: { createdAt: "desc" },
          take: 24
        })
      ]);

    const wins = closedTrades.filter((trade) => trade.realizedPnlUsd > 0).length;
    const totalPnl = closedTrades.reduce(
      (sum, trade) => sum + trade.realizedPnlUsd,
      0
    );

    return {
      totalTrades,
      openTrades,
      closedTrades: closedTrades.length,
      winRate: pct(wins, closedTrades.length),
      totalPnlUsd: Number(totalPnl.toFixed(2)),
      exitsCount: exits.length,
      recentRuns: jobRuns
    };
  });

  app.get("/dashboard/trades", async () => {
    const trades = await prisma.trade.findMany({
      include: {
        exits: {
          orderBy: { executedAt: "asc" }
        },
        signal: true
      },
      orderBy: { openedAt: "desc" },
      take: 200
    });

    return trades;
  });

  app.get("/dashboard", async (request, reply) => {
    const stats = await app.inject({
      method: "GET",
      url: "/dashboard/stats"
    });
    const payload = stats.json();

    const recentTrades = await prisma.trade.findMany({
      include: { exits: true },
      orderBy: { openedAt: "desc" },
      take: 20
    });

    const rows = recentTrades
      .map((trade) => {
        const exitsText =
          trade.exits
            .map(
              (exit) =>
                `${exit.reason}: qty ${exit.quantity.toFixed(6)} @ ${currency(exit.price)}`
            )
            .join(" | ") || "-";
        return `<tr>
          <td>${trade.symbol}</td>
          <td>${trade.status}</td>
          <td>${currency(trade.entryPrice)}</td>
          <td>${trade.quantity.toFixed(6)}</td>
          <td>${trade.remainingQty.toFixed(6)}</td>
          <td>${currency(trade.realizedPnlUsd)}</td>
          <td>${new Date(trade.openedAt).toISOString()}</td>
          <td>${exitsText}</td>
        </tr>`;
      })
      .join("");

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trading Bot Dashboard</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; background: #0b1020; color: #e5e7eb; }
    h1, h2 { margin: 0 0 12px; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .card { background: #111827; border: 1px solid #1f2937; padding: 12px; border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 8px; border-bottom: 1px solid #1f2937; text-align: left; vertical-align: top; }
    th { color: #93c5fd; }
  </style>
</head>
<body>
  <h1>Binance Futures - Volume Spike Bot</h1>
  <div class="grid">
    <div class="card"><strong>Total trades</strong><br>${payload.totalTrades}</div>
    <div class="card"><strong>Open trades</strong><br>${payload.openTrades}</div>
    <div class="card"><strong>Closed trades</strong><br>${payload.closedTrades}</div>
    <div class="card"><strong>Win rate</strong><br>${payload.winRate.toFixed(2)}%</div>
    <div class="card"><strong>Total PnL</strong><br>$${currency(payload.totalPnlUsd)}</div>
    <div class="card"><strong>Total exits</strong><br>${payload.exitsCount}</div>
  </div>

  <h2>Recent Trades</h2>
  <table>
    <thead>
      <tr>
        <th>Symbol</th>
        <th>Status</th>
        <th>Entry</th>
        <th>Qty</th>
        <th>Remaining</th>
        <th>PNL USD</th>
        <th>Opened At</th>
        <th>Exits</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;

    reply.type("text/html").send(html);
  });
}
