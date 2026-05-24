import cors from "cors";
import express from "express";
import { analysisRouter } from "./routes/analysisRoutes.js";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api", analysisRouter);
  return app;
}
