import * as dotenv from "dotenv";
dotenv.config(); // ✅ loads .env into process.env

import express from "express";
import cors from "cors";
import { logger } from "./utils/logger";
import { mcpRouter } from "./routes/mcpRouter";
import { webhooksRouter } from "./routes/webhooks";


const app = express();

// read port from env, fallback to 3000
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.use("/mcp", mcpRouter);
app.use("/webhooks", webhooksRouter);

app.use(
  (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, "Unhandled error");
    res.status(500).json({ error: "internal_error" });
  }
);

app.listen(PORT, () => {
  logger.info(`MCP mood server listening on :${PORT}`);
});


