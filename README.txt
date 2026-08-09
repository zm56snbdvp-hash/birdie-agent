BIRDIE AGENT — CLOUD RUN v1

Files:
- server.mjs
- package.json

DO NOT put API keys into these files.

Google Cloud Run environment variables required:
OPENAI_API_KEY
BIRDIE_OS_API_KEY

Optional:
OPENAI_MODEL=gpt-5
BIRDIE_OS_BASE=<Apps Script deployment base URL>

Routes:
GET /
GET /health
POST /chat
JSON body: {"message":"Birdie, gib mir meinen nächsten Task."}