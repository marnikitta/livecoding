all: .venv static/dist/bundle.js

run: .venv static/dist/bundle.js
	poetry run python -m livecoding.main

lint_backend: .venv
	poetry run mypy --check-untyped-defs --ignore-missing-imports livecoding

.venv: poetry.lock
	poetry install

watch_front: node_modules
	node_modules/.bin/esbuild static/app.js --bundle --sourcemap --outfile=static/dist/bundle.js --watch

static/dist/bundle.js: node_modules
	node_modules/.bin/esbuild static/app.js --minify --bundle --outfile=static/dist/bundle.js

node_modules: package.json package-lock.json
	npm install

clean:
	rm -rf node_modules
	rm -rf static/dist
	rm -rf .venv

.PHONY: all clean run lint_backend watch_front clean
