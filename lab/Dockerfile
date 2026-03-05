FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY src/ src/
EXPOSE 8000
CMD ["uv", "run", "rating", "serve"]
