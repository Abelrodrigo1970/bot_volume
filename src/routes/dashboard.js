import { prisma } from "../db/client.js";
import { startSignalJob } from "./jobs.js";

function pct(win, total) {
  if (total === 0) {
    return 0;
  }
  return (win / total) * 100;
}

function currency(value) {
  return Number(value).toFixed(2);
}

function formatDateTime(date) {
  const d = new Date(date);
  return d.toLocaleString("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatVolume(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
}

export async function registerDashboardRoutes(app, config) {
  app.get("/dashboard/trigger-job", async (request, reply) => {
    try {
      const result = await startSignalJob(config, app.log);
      return reply.send(result);
    } catch (err) {
      app.log.error(err);
      return reply.code(500).send({
        ok: false,
        message: err instanceof Error ? err.message : "Erro ao iniciar procura"
      });
    }
  });

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

    const [recentTrades, recentLongSignals] = await Promise.all([
      prisma.trade.findMany({
        include: { exits: true },
        orderBy: { openedAt: "desc" },
        take: 20
      }),
      prisma.signal.findMany({
        where: { side: "LONG" },
        orderBy: { createdAt: "desc" },
        take: 30
      })
    ]);

    const rows = recentTrades
      .map((trade) => {
        const exitsText =
          trade.exits
            .map(
              (exit) =>
                `${exit.reason}: qty ${exit.quantity.toFixed(6)} @ ${currency(exit.price)}`
            )
            .join(" | ") || "-";
        const openedAtStr = formatDateTime(trade.openedAt);
        const closedAtStr = trade.closedAt
          ? formatDateTime(trade.closedAt)
          : "-";
        const symbolCell =
          trade.binanceOrderFilled === false
            ? `${trade.symbol} <span style="color:#f59e0b" title="Ordem de abertura na Binance falhou">(ordem falhou)</span>`
            : trade.symbol;
        return `<tr>
          <td>${symbolCell}</td>
          <td>${trade.status}</td>
          <td>${Number(trade.entryPrice).toFixed(6)}</td>
          <td>${trade.quantity.toFixed(6)}</td>
          <td>${trade.remainingQty.toFixed(6)}</td>
          <td>${currency(trade.realizedPnlUsd)}</td>
          <td>${openedAtStr}</td>
          <td>${closedAtStr}</td>
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
  <p style="font-size:13px;color:#9ca3af;margin:0 0 12px;">Estratégia: intervalo <strong>${config.INTERVAL}</strong>, janela <strong>${config.VOLUME_WINDOW}</strong> velas, spike ≥<strong>${config.SPIKE_MULTIPLIER}×</strong> média. LONG se: vela bullish OU (vela bear e close &gt; MA(${config.MA_PERIODS ?? 200})). Símbolos: <strong>${config.symbolSort}</strong>. Variables: INTERVAL, VOLUME_WINDOW, MA_PERIODS, SPIKE_MULTIPLIER, SYMBOL_SORT.</p>
  <div class="grid">
    <div class="card"><strong>Total trades</strong><br>${payload.totalTrades}</div>
    <div class="card">
      <strong>Executar procura</strong><br>
      <button id="btn-trigger" type="button" style="margin-top:6px;padding:6px 12px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;">Executar procura</button>
      <span id="trigger-msg" style="margin-left:8px;font-size:12px;"></span>
    </div>
    <div class="card"><strong>Open trades</strong><br>${payload.openTrades}</div>
    <div class="card"><strong>Closed trades</strong><br>${payload.closedTrades}</div>
    <div class="card"><strong>Win rate</strong><br>${payload.winRate.toFixed(2)}%</div>
    <div class="card"><strong>Total PnL</strong><br>$${currency(payload.totalPnlUsd)}</div>
    <div class="card"><strong>Total exits</strong><br>${payload.exitsCount}</div>
    <div class="card">
      <strong>Atualizar dados</strong><br>
      <button type="button" onclick="location.reload()" style="margin-top:6px;padding:6px 12px;background:#1f2937;color:#e5e7eb;border:1px solid #374151;border-radius:6px;cursor:pointer;">Atualizar</button>
    </div>
  </div>

  <h2>Últimas execuções</h2>
  <p style="font-size:13px;color:#9ca3af;margin:0 0 8px;">A procura em 500 símbolos pode demorar vários minutos. Clica <strong>Atualizar</strong> para ver o estado e os trades. <strong>Sinais LONG</strong> = símbolos com volume ≥6× média (20h) + vela bullish. Se Sinais LONG &gt; 0 mas Trades = 0, a ordem na Binance pode ter falhado (ver logs no Railway).</p>
  <table style="margin-bottom:24px;">
    <thead>
      <tr>
        <th>Início</th>
        <th>Fim</th>
        <th>Origem</th>
        <th>Símbolos</th>
        <th>Estado</th>
        <th>Trades abertos</th>
        <th>Sinais LONG</th>
        <th>Erro</th>
      </tr>
    </thead>
    <tbody>
      ${(payload.recentRuns || [])
        .map(
          (r) => `
        <tr>
          <td>${formatDateTime(r.createdAt)}</td>
          <td>${r.finishedAt ? formatDateTime(r.finishedAt) : "<em>a correr...</em>"}</td>
          <td>${r.source || "-"}</td>
          <td>${r.symbols || "-"}</td>
          <td>${r.finishedAt ? (r.success ? "OK" : "Falhou") : "A correr"}</td>
          <td>${r.openedTrades ?? "-"}</td>
          <td>${r.signalsCount ?? "-"}</td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;">${r.error || "-"}</td>
        </tr>`
        )
        .join("")}
    </tbody>
  </table>

  <h2>Últimos sinais LONG</h2>
  <p style="font-size:13px;color:#9ca3af;margin:0 0 8px;">Símbolos que cumpriram a regra (volume ≥6× média + vela bullish). Se aparecem aqui mas não há trade no histórico, a ordem na Binance pode ter falhado (ver logs).</p>
  <table style="margin-bottom:24px;">
    <thead>
      <tr>
        <th>Symbol</th>
        <th>Data/Hora</th>
        <th>Spike (×média)</th>
        <th>Média 20 velas</th>
        <th>Volume vela entrada</th>
        <th>Motivo</th>
      </tr>
    </thead>
    <tbody>
      ${recentLongSignals
        .map(
          (s) => `
        <tr>
          <td>${s.symbol}</td>
          <td>${formatDateTime(s.createdAt)}</td>
          <td>${Number(s.spikeRatio).toFixed(2)}×</td>
          <td>${formatVolume(s.averageVolume)}</td>
          <td>${formatVolume(s.currentVolume)}</td>
          <td style="max-width:220px;">${s.reason || "-"}</td>
        </tr>`
        )
        .join("")}
      ${recentLongSignals.length === 0 ? "<tr><td colspan='6'>Nenhum sinal LONG registado ainda.</td></tr>" : ""}
    </tbody>
  </table>

  <h2>Histórico de Trades</h2>
  <table>
    <thead>
      <tr>
        <th>Symbol</th>
        <th>Status</th>
        <th>Entry</th>
        <th>Qty</th>
        <th>Remaining</th>
        <th>PNL USD</th>
        <th>Data/Hora abertura</th>
        <th>Data/Hora fecho</th>
        <th>Exits</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <script>
    document.getElementById('btn-trigger').onclick = function() {
      var btn = this;
      var msg = document.getElementById('trigger-msg');
      btn.disabled = true;
      msg.textContent = 'A iniciar...';
      fetch('/dashboard/trigger-job')
        .then(function(r) { return r.json(); })
        .then(function(d) {
          msg.textContent = d.ok ? 'Procura iniciada (runId: ' + d.runId + ')' : (d.message || 'Erro');
          btn.disabled = false;
        })
        .catch(function() {
          msg.textContent = 'Erro de rede';
          btn.disabled = false;
        });
    };
  </script>
</body>
</html>`;

    reply.type("text/html").send(html);
  });
}
