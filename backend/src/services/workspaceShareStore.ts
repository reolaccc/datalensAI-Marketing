import { randomUUID } from "node:crypto";
import type { AnalysisResult, QuestionAnswer } from "../analytics/types.js";

export interface WorkspaceShareSnapshot {
  id: string;
  label: string;
  fileName: string;
  savedAt: string;
  analysis: AnalysisResult;
  questionAnswer: QuestionAnswer | null;
  questionHistory: QuestionAnswer[];
  pinnedInsights: Array<QuestionAnswer & { id: string; pinnedAt: string }>;
}

const sharedWorkspaces = new Map<string, WorkspaceShareSnapshot>();

export function createWorkspaceShare(snapshot: WorkspaceShareSnapshot) {
  const shareId = randomUUID();
  sharedWorkspaces.set(shareId, snapshot);
  return shareId;
}

export function getWorkspaceShare(shareId: string) {
  return sharedWorkspaces.get(shareId) ?? null;
}
