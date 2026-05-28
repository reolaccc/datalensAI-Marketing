import cors from "cors";
import express from "express";
import multer from "multer";
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
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      response.status(413).json({ message: "The file is too large for local analysis. Please try a smaller CSV or XLSX file." });
      return;
    }

    const message = error instanceof Error ? error.message : "Server error";
    response.status(500).json({ message });
  });
  return app;
}
