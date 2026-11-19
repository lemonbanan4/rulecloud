# Stage 1: Build MoeidHeidari/guardrail from source
FROM golang:1.26-alpine AS guardrail-builder
ENV GOTOOLCHAIN=auto
RUN apk add --no-cache git
WORKDIR /src
RUN git clone --depth 1 https://github.com/MoeidHeidari/guardrail.git .
RUN go mod tidy && go build -o /guardrail ./cmd/guardrail || go build -o /guardrail .

# Stage 2: FastAPI Python runtime
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy compiled guardrail binary into PATH
COPY --from=guardrail-builder /guardrail /usr/local/bin/guardrail
RUN chmod +x /usr/local/bin/guardrail

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]