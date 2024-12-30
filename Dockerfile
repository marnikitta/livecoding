FROM node:latest AS frontend-builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY ./frontend/ ./frontend
COPY ./Makefile ./
RUN make build_front

FROM python:3.12-slim AS server
ENV PYTHONUNBUFFERED 1

WORKDIR /app

RUN pip install poetry
COPY pyproject.toml poetry.lock poetry.toml README.md ./
RUN poetry install --no-dev --no-interaction --no-ansi

COPY frontend ./frontend
COPY livecoding ./livecoding
COPY Makefile ./
COPY --from=frontend-builder /app/frontend/public/bundle.js ./frontend/public/

EXPOSE 5000
#CMD ["bash"]
CMD ["poetry", "run", "python", "-m", "livecoding.main"]