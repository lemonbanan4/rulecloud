# Rule Cloud

Monorepo for Guardrail static analysis:

| Path | Stack | Deploy |
|------|--------|--------|
| `/` | FastAPI + MoeidHeidari/guardrail | [Railway](https://railway.com/project/15e42433-0031-42bc-a46c-2ac4349e6883) (`Dockerfile`) |
| `/web` | Next.js 16 + Tailwind | [Vercel](https://vercel.com) — set **Root Directory** to `web` |

Frontend env: `NEXT_PUBLIC_API_URL` → Railway API URL (see `web/.env.example`).