all: lint_backend build_prod_front

run: lint_backend build_prod_front
	poetry run python -m livecoding.main

lint_backend:
	poetry run mypy --check-untyped-defs --ignore-missing-imports livecoding

watch_front:
	node_modules/.bin/esbuild static/app.js --bundle --sourcemap --outfile=static/dist/bundle.js --watch

build_prod_front:
	node_modules/.bin/esbuild static/app.js --minify --bundle --outfile=static/dist/bundle.js
