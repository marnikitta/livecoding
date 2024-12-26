watch-front:
	node_modules/.bin/esbuild static/app.js --bundle --sourcemap --outfile=static/dist/bundle.js --watch

lint:
	poetry run mypy --check-untyped-defs --ignore-missing-imports livecoding

build-prod-front:
	node_modules/.bin/esbuild static/app.js --minify --bundle --outfile=static/dist/bundle.js
