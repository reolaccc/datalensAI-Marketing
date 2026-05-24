# Deployment Prompts

This file is a prompt reference for the user. It is not an instruction file for Codex to automatically execute.

# DataLens Deployment Prompts

This file stores the two Codex prompts for preparing the DataLens project for GitHub, Render deployment, and future LLM API integration.

---

## Step 1: Safely Prepare DataLens for GitHub

```text
Please help me safely prepare my current local DataLens project for GitHub first.

Context:
This is my existing DataLens web app. It may still have some frontend issues, so this is not a final production release yet. I want to put it on GitHub first for version control and backup.

Important:
- Inspect the codebase first.
- Do not rewrite the whole app.
- Do not change unrelated UI or business logic.
- Make the smallest safe changes.
- Do not push to GitHub until I confirm.

Tasks:
1. Check the project structure and tell me the tech stack.
2. Check whether the app can run locally.
3. Run or check:
   npm install
   npm run build
4. Search for exposed secrets, API keys, tokens, passwords, .env files, OpenAI keys, DeepSeek keys, or GitHub tokens.
5. Make sure no real secrets will be committed.
6. Add or update .gitignore to exclude:
   node_modules
   .env
   .env.local
   .env.*.local
   dist
   build
   coverage
   logs
   *.log
   .DS_Store
7. Create or update .env.example with placeholder values only, such as:
   OPENAI_API_KEY=
   DEEPSEEK_API_KEY=
   LLM_PROVIDER=
   PORT=
8. Tell me whether the project is safe to push to GitHub.
9. Show me the files you changed.
10. Give me the exact Git commands, but do not push until I confirm.

Goal:
Make the project safe for GitHub first. Render deployment and future LLM backend structure can be handled after GitHub is ready.
```

---

## Step 2: Prepare DataLens for Render and Future LLM API Integration

```text
Now please help me prepare this GitHub project for Render deployment and future LLM API integration.

Context:
This is my DataLens web app. It is already prepared for GitHub or has been pushed to GitHub. I plan to deploy it on Render. Later I want to connect DeepSeek, OpenAI, or other LLM APIs.

Important:
- Inspect the current project first.
- Do not rewrite the whole app.
- Do not change unrelated UI or business logic.
- Do not expose API keys in frontend/browser code.
- Keep changes small and safe.
- Do not implement real DeepSeek/OpenAI API calls yet unless the project already has them.

Tasks:
1. Decide whether this project should be deployed as a Render Static Site or Render Web Service.
2. If frontend-only, prepare Render Static Site settings:
   - build command
   - publish directory
   - environment variables if needed
3. If backend is already present, prepare Render Web Service settings:
   - build command
   - start command
   - PORT handling with process.env.PORT
   - required environment variables
4. Because I plan to connect DeepSeek/OpenAI later, explain whether I should keep it frontend-only for now or prepare a backend.
5. Future LLM API keys must stay server-side only.
6. The frontend should eventually call my own backend endpoint, not DeepSeek/OpenAI directly.
7. Suggest a simple future provider abstraction structure for:
   - OpenAI
   - DeepSeek
   - other LLM providers later
8. Do not overbuild the backend now.
9. Add render.yaml only if it is useful and fits the current project structure.
10. Give me exact Render deployment steps:
   - service type
   - build command
   - start command or publish directory
   - environment variables to add
   - how to redeploy after GitHub push
11. Show me all files changed and explain why.

Goal:
Prepare the project for Render deployment safely, while keeping the future LLM API structure clean and secure.
```

---

## Usage Note

Recommended workflow:

1. Use Step 1 first in Codex.
2. Push the project to GitHub only after checking changed files.
3. After GitHub is ready, use Step 2 in a new Codex task or clean conversation.
4. Keep API keys only in server-side environment variables, never in frontend/browser code.
