import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  AnalysisResponse,
  PinnedInsight,
  QuestionAnswer,
  QuestionContextInput,
  WorkspaceSnapshot
} from "../types";

interface AnalysisState {
  fileName: string | null;
  lastFile: File | null;
  draftQuestion: string;
  loading: boolean;
  asking: boolean;
  error: string | null;
  analysis: AnalysisResponse | null;
  questionAnswer: QuestionAnswer | null;
  questionHistory: QuestionAnswer[];
  pinnedInsights: PinnedInsight[];
  workspaceSnapshots: WorkspaceSnapshot[];
  recentWorkspaceSnapshotIds: string[];
  activeWorkspaceSnapshotId: string | null;
  analyzeFile: (file: File) => Promise<void>;
  askQuestion: (question: string, context?: QuestionContextInput) => Promise<void>;
  setDraftQuestion: (question: string) => void;
  pinCurrentAnswer: () => void;
  removePinnedInsight: (id: string) => void;
  clearCurrentAnalysis: () => void;
  saveCurrentWorkspaceSnapshot: () => string | null;
  openWorkspaceSnapshot: (id: string) => void;
  removeWorkspaceSnapshot: (id: string) => void;
  shareCurrentWorkspace: () => Promise<string | null>;
  importSharedWorkspaceSnapshot: (snapshot: WorkspaceSnapshot) => void;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const STORAGE_KEY = "analytics-copilot.workspace-state";
const DEFAULT_DRAFT_QUESTION = "";
const noopStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined
};

function createWorkspaceLabel(fileName: string, savedAt: string) {
  const formattedDate = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(savedAt));

  return `${fileName} · ${formattedDate}`;
}

function createSnapshotId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}`;
}

function buildWorkspaceSnapshot(
  state: Pick<AnalysisState, "analysis" | "fileName" | "questionAnswer" | "questionHistory" | "pinnedInsights">
) {
  if (!state.analysis) {
    return null;
  }

  const savedAt = new Date().toISOString();
  return {
    id: createSnapshotId(),
    label: createWorkspaceLabel(state.fileName ?? state.analysis.fileName, savedAt),
    fileName: state.fileName ?? state.analysis.fileName,
    savedAt,
    analysis: state.analysis,
    questionAnswer: state.questionAnswer,
    questionHistory: state.questionHistory,
    pinnedInsights: state.pinnedInsights
  } satisfies WorkspaceSnapshot;
}

function touchRecentWorkspaceSnapshotIds(currentIds: string[], snapshotId: string) {
  return [snapshotId, ...currentIds.filter((id) => id !== snapshotId)].slice(0, 6);
}

function buildQuestionContextSnapshot(context?: QuestionContextInput) {
  if (!context) {
    return undefined;
  }

  const snapshot = {
    selectedDate: context.selectedDate,
    selectedThreshold: context.selectedThreshold,
    selectedMetric: context.selectedMetric,
    selectedDimension: context.selectedDimension,
    selectedCategory: context.selectedCategory,
    selectedSegmentA: context.selectedSegmentA,
    selectedSegmentB: context.selectedSegmentB,
    useAi: context.useAi
  };

  return Object.values(snapshot).some((value) => value !== undefined && value !== "" && value !== false)
    ? snapshot
    : undefined;
}

export const useAnalysisStore = create<AnalysisState>()(
  persist(
    (set, get) => ({
      fileName: null,
      lastFile: null,
      draftQuestion: DEFAULT_DRAFT_QUESTION,
      loading: false,
      asking: false,
      error: null,
      analysis: null,
      questionAnswer: null,
      questionHistory: [],
      pinnedInsights: [],
      workspaceSnapshots: [],
      recentWorkspaceSnapshotIds: [],
      activeWorkspaceSnapshotId: null,
      analyzeFile: async (file) => {
        set({
          loading: true,
          error: null,
          fileName: file.name,
          lastFile: file,
          draftQuestion: DEFAULT_DRAFT_QUESTION,
          questionAnswer: null,
          questionHistory: [],
          pinnedInsights: [],
          activeWorkspaceSnapshotId: null
        });
        const formData = new FormData();
        formData.append("file", file);

        try {
          const response = await fetch(`${API_BASE_URL}/api/analyze`, {
            method: "POST",
            body: formData
          });

          if (!response.ok) {
            const body = (await response.json().catch(() => ({}))) as { message?: string };
            throw new Error(body.message ?? "Upload failed");
          }

          const analysis = (await response.json()) as AnalysisResponse;
          set({ analysis, loading: false });
        } catch (error) {
          set({
            loading: false,
            error: error instanceof Error ? error.message : "Unknown upload error"
          });
        }
      },
      askQuestion: async (question, context) => {
        const analysis = get().analysis;
        if (!analysis) {
          set({ error: "Upload a dataset before asking questions." });
          return;
        }

        set({ asking: true, error: null });

        async function requestQuestionAnswer(analysisId: string) {
          const response = await fetch(`${API_BASE_URL}/api/questions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              analysisId,
              question,
              context
            })
          });

          if (!response.ok) {
            const body = (await response.json().catch(() => ({}))) as { message?: string };
            const message = body.message ?? "Question request failed";
            const error = new Error(message);
            (error as Error & { status?: number }).status = response.status;
            throw error;
          }

          return (await response.json()) as QuestionAnswer;
        }

        try {
          let questionAnswer: QuestionAnswer;
          try {
            questionAnswer = await requestQuestionAnswer(analysis.analysisId);
          } catch (error) {
            const status = error instanceof Error ? (error as Error & { status?: number }).status : undefined;
            const lastFile = get().lastFile;
            if (status === 404 && lastFile) {
              await get().analyzeFile(lastFile);
              const refreshedAnalysis = get().analysis;
              if (!refreshedAnalysis) {
                throw error;
              }
              questionAnswer = await requestQuestionAnswer(refreshedAnalysis.analysisId);
            } else {
              throw error;
            }
            }

          const questionContext = buildQuestionContextSnapshot(context);
          const enhancedQuestionAnswer: QuestionAnswer = {
            ...questionAnswer,
            questionContext
          };

          set((state) => ({
            draftQuestion: question,
            questionAnswer: enhancedQuestionAnswer,
            asking: false,
            questionHistory: [enhancedQuestionAnswer, ...state.questionHistory].slice(0, 6)
          }));
        } catch (error) {
          set({
            asking: false,
            error: error instanceof Error ? error.message : "Unknown question error"
          });
        }
      },
      setDraftQuestion: (question) => {
        set({ draftQuestion: question });
      },
      pinCurrentAnswer: () => {
        const { questionAnswer } = get();
        if (!questionAnswer) {
          return;
        }

        set((state) => {
          const existing = state.pinnedInsights.find((insight) => insight.question === questionAnswer.question);
          if (existing) {
            return state;
          }

          const pinnedInsight: PinnedInsight = {
            ...questionAnswer,
            id: createSnapshotId(),
            pinnedAt: new Date().toISOString()
          };

          return {
            pinnedInsights: [pinnedInsight, ...state.pinnedInsights].slice(0, 8)
          };
        });
      },
      removePinnedInsight: (id) => {
        set((state) => ({
          pinnedInsights: state.pinnedInsights.filter((insight) => insight.id !== id)
        }));
      },
      clearCurrentAnalysis: () => {
        set({
          fileName: null,
          lastFile: null,
          draftQuestion: DEFAULT_DRAFT_QUESTION,
          loading: false,
          asking: false,
          error: null,
          analysis: null,
          questionAnswer: null,
          questionHistory: [],
          pinnedInsights: [],
          activeWorkspaceSnapshotId: null
        });
      },
      saveCurrentWorkspaceSnapshot: () => {
        const state = get();
        if (!state.analysis) {
          return null;
        }

        const savedAt = new Date().toISOString();
        const snapshot: WorkspaceSnapshot = {
          id: createSnapshotId(),
          label: createWorkspaceLabel(state.fileName ?? state.analysis.fileName, savedAt),
          fileName: state.fileName ?? state.analysis.fileName,
          savedAt,
          analysis: state.analysis,
          questionAnswer: state.questionAnswer,
          questionHistory: state.questionHistory,
          pinnedInsights: state.pinnedInsights
        };

        set((current) => ({
          workspaceSnapshots: [snapshot, ...current.workspaceSnapshots].slice(0, 10),
          recentWorkspaceSnapshotIds: touchRecentWorkspaceSnapshotIds(
            current.recentWorkspaceSnapshotIds,
            snapshot.id
          ),
          activeWorkspaceSnapshotId: snapshot.id
        }));

        return snapshot.id;
      },
      openWorkspaceSnapshot: (id) => {
        const snapshot = get().workspaceSnapshots.find((item) => item.id === id);
        if (!snapshot) {
          return;
        }

        set({
          fileName: snapshot.fileName,
          lastFile: null,
          draftQuestion: snapshot.questionAnswer?.question ?? "",
          loading: false,
          asking: false,
          error: null,
          analysis: snapshot.analysis,
          questionAnswer: snapshot.questionAnswer,
          questionHistory: snapshot.questionHistory,
          pinnedInsights: snapshot.pinnedInsights,
          recentWorkspaceSnapshotIds: touchRecentWorkspaceSnapshotIds(
            get().recentWorkspaceSnapshotIds,
            snapshot.id
          ),
          activeWorkspaceSnapshotId: snapshot.id
        });
      },
      removeWorkspaceSnapshot: (id) => {
        set((state) => ({
          workspaceSnapshots: state.workspaceSnapshots.filter((snapshot) => snapshot.id !== id),
          recentWorkspaceSnapshotIds: state.recentWorkspaceSnapshotIds.filter((snapshotId) => snapshotId !== id),
          activeWorkspaceSnapshotId: state.activeWorkspaceSnapshotId === id ? null : state.activeWorkspaceSnapshotId
        }));
      },
      shareCurrentWorkspace: async () => {
        const snapshot = buildWorkspaceSnapshot(get());
        if (!snapshot) {
          return null;
        }

        const response = await fetch(`${API_BASE_URL}/api/workspaces/share`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(snapshot)
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? "Workspace share failed");
        }

        const result = (await response.json()) as { shareId: string };
        return `${window.location.origin}/?share=${result.shareId}`;
      },
      importSharedWorkspaceSnapshot: (snapshot) => {
        set((state) => {
          const nextSnapshots = state.workspaceSnapshots.filter((item) => item.id !== snapshot.id);
          return {
            workspaceSnapshots: [snapshot, ...nextSnapshots].slice(0, 10),
            recentWorkspaceSnapshotIds: touchRecentWorkspaceSnapshotIds(
              state.recentWorkspaceSnapshotIds,
              snapshot.id
            ),
            fileName: snapshot.fileName,
            lastFile: null,
            draftQuestion: snapshot.questionAnswer?.question ?? "",
            loading: false,
            asking: false,
            error: null,
            analysis: snapshot.analysis,
            questionAnswer: snapshot.questionAnswer,
            questionHistory: snapshot.questionHistory,
            pinnedInsights: snapshot.pinnedInsights,
            activeWorkspaceSnapshotId: snapshot.id
          };
        });
      }
    }),
    {
      name: STORAGE_KEY,
      version: 2,
      storage: createJSONStorage(() => (typeof window === "undefined" ? noopStorage : window.localStorage)),
      migrate: (persistedState) => {
        const state = persistedState as Partial<AnalysisState> | undefined;
        return {
          workspaceSnapshots: state?.workspaceSnapshots ?? [],
          recentWorkspaceSnapshotIds: state?.recentWorkspaceSnapshotIds ?? []
        };
      },
      partialize: (state) => ({
        workspaceSnapshots: state.workspaceSnapshots,
        recentWorkspaceSnapshotIds: state.recentWorkspaceSnapshotIds
      })
    }
  )
);
