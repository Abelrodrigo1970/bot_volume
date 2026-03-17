import Fastify from "fastify";

import { config } from "./config/env.js";
import { prisma } from "./db/client.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerJobRoutes } from "./routes/jobs.js";

const app = Fastify({
  logger: true
});

app.get("/", async (_request, reply) => reply.redirect(302, "/dashboard"));
app.get("/health", async () => ({ ok: true }));

await registerJobRoutes(app, config);
await registerDashboardRoutes(app);

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

app
  .listen({ host: "0.0.0.0", port: config.PORT })
  .then(() => {
    app.log.info(`Server running on port ${config.PORT}`);
  })
  .catch(async (error) => {
    app.log.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
