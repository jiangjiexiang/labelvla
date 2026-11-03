# One repository builds both the Studio UI and the LabelVLA Python backend.
ARG PYTHON_DEPENDENCY_IMAGE=python:3.11-slim
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN BASE_PATH=/ npm run build

FROM ${PYTHON_DEPENDENCY_IMAGE} AS runtime-base
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
    LABELVLA_HEADLESS=1 PYTHONPATH=/app/backend \
    DATA_ROOT=/data OUTPUT_ROOT=/output LABELVLA_DATA_ROOTS=/data:/output \
    STATIC_DIR=/app/static
COPY requirements.lock ./requirements.lock
ARG PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/
RUN pip install --timeout 120 --retries 3 --index-url "$PIP_INDEX_URL" -r requirements.lock
RUN rm -rf /app/backend /app/static
COPY backend/ /app/backend/
COPY frontend/LICENSE /app/licenses/Studio-LICENSE
COPY frontend/NOTICE /app/licenses/Studio-NOTICE
COPY backend/LICENSE /app/licenses/LabelVLA-LICENSE
LABEL org.opencontainers.image.source="https://github.com/jiangjiexiang/labelvla"
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)"
ENTRYPOINT ["python"]
CMD ["-m", "uvicorn", "bridge:app", "--host", "0.0.0.0", "--port", "8000"]

FROM runtime-base AS runtime
COPY --from=frontend-build /build/frontend/dist/ /app/static/
