import { Router } from "express";
import multer from "multer";
import { answerDatasetQuestion } from "../analytics/answerQuestion.js";
import { analyzeUploadedDataset } from "../services/analysisService.js";
import { getAnalysisSession } from "../services/analysisSessionStore.js";
import { createWorkspaceShare, getWorkspaceShare } from "../services/workspaceShareStore.js";
import { uploadedFileSchema } from "../validators/analysis.js";
import { questionRequestSchema } from "../validators/questions.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

export const analysisRouter = Router();

analysisRouter.get("/health", (_request, response) => {
  response.json({ ok: true });
});

analysisRouter.post("/analyze", upload.single("file"), async (request, response) => {
  try {
    const file = uploadedFileSchema.parse(request.file);
    const result = await analyzeUploadedDataset(file.buffer, file.originalname);
    response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed";
    response.status(400).json({ message });
  }
});

analysisRouter.post("/questions", async (request, response) => {
  try {
    const { analysisId, question, context } = questionRequestSchema.parse(request.body);
    const session = getAnalysisSession(analysisId);

    if (!session) {
      response.status(404).json({ message: "Analysis session not found. Re-upload the dataset and try again." });
      return;
    }

    const answer = await answerDatasetQuestion(question, {
      fileName: session.fileName,
      rows: session.rows,
      profile: session.profile,
      input: context
    });

    response.json(answer);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Question answering failed";
    response.status(400).json({ message });
  }
});

analysisRouter.post("/workspaces/share", (request, response) => {
  try {
    const snapshot = request.body as Parameters<typeof createWorkspaceShare>[0];

    if (!snapshot?.analysis?.analysisId || !snapshot?.fileName || !snapshot?.savedAt) {
      response.status(400).json({ message: "Workspace snapshot is incomplete." });
      return;
    }

    const shareId = createWorkspaceShare(snapshot);
    response.status(201).json({
      shareId,
      shareUrl: `/api/workspaces/share/${shareId}`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workspace share failed";
    response.status(400).json({ message });
  }
});

analysisRouter.get("/workspaces/share/:shareId", (request, response) => {
  const snapshot = getWorkspaceShare(request.params.shareId);

  if (!snapshot) {
    response.status(404).json({ message: "Shared workspace not found." });
    return;
  }

  response.json(snapshot);
});
