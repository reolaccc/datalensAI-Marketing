import cors from "cors";
import express from "express";
import { analysisRouter } from "./routes/analysisRoutes.js";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use((request, response, next) => {
    const startedAt = Date.now();
    const path = request.originalUrl ?? request.url;
    console.log(
      `[request:start] ${new Date(startedAt).toISOString()} ${request.method} ${path}`
    );

    response.on("finish", () => {
      const durationMs = Date.now() - startedAt;
      console.log(
        `[request:finish] ${new Date().toISOString()} ${request.method} ${path} ${response.statusCode} ${durationMs}ms`
      );
    });

    next();
  });
  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.use("/api", analysisRouter);
  return app;
}
