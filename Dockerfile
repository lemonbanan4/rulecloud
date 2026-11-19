FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Official Guardrail CLI (npm). Override GUARDRAIL_INSTALL_CMD to use another distribution.
ARG GUARDRAIL_INSTALL_CMD="npm install -g guardrail"
RUN bash -c "${GUARDRAIL_INSTALL_CMD}" && command -v guardrail

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]