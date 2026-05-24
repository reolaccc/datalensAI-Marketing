import { randomUUID } from "node:crypto";
import type { DatasetProfile, DatasetRow } from "../analytics/types.js";

export interface AnalysisSession {
  analysisId: string;
  fileName: string;
  sheetName?: string;
  rows: DatasetRow[];
  profile: DatasetProfile;
  createdAt: string;
}

const sessions = new Map<string, AnalysisSession>();

export function createAnalysisSession(input: Omit<AnalysisSession, "analysisId" | "createdAt">) {
  const analysisId = randomUUID();
  const session: AnalysisSession = {
    ...input,
    analysisId,
    createdAt: new Date().toISOString()
  };
  sessions.set(analysisId, session);
  return session;
}

export function getAnalysisSession(analysisId: string) {
  return sessions.get(analysisId) ?? null;
}
