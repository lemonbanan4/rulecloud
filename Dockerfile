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

# Static-analysis Guardrail CLI. Override GUARDRAIL_INSTALL_CMD for another distribution.
ARG GUARDRAIL_INSTALL_CMD="npm install -g @guardrail-ai/cli"
ENV PATH="/usr/local/bin:${PATH}"
RUN bash -c "${GUARDRAIL_INSTALL_CMD}" && guardrail --version

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]