# Rule Cloud

Monorepo for Guardrail static analysis:

| Path | Stack | Deploy |
|------|--------|--------|
| `/` | FastAPI + MoeidHeidari/guardrail | [Railway](https://railway.com/project/15e42433-0031-42bc-a46c-2ac4349e6883) (`Dockerfile`) |
| `/web` | Next.js 16 + Tailwind | [Vercel](https://rulecloud.vercel.app) (Root Directory: `web`) |

**Production URLs**
- Frontend: https://rulecloud.vercel.app
- API: https://rulecloud-production.up.railway.app

Frontend env on Vercel: `NEXT_PUBLIC_API_URL` → Railway API URL (see `web/.env.example`).
Railway env: `FRONTEND_URL` → Vercel URL (for CORS).