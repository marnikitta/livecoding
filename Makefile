# Nice guide
# https://www.olioapps.com/blog/the-lost-art-of-the-makefile

host := livecoding
bundle_path := frontend/public/bundle.js
deploy_files := livecoding frontend poetry.toml README.md poetry.lock pyproject.toml

all: build

run: build
	poetry run python -m livecoding.main

build: .venv $(bundle_path)

lint: .venv
	poetry run mypy --check-untyped-defs --ignore-missing-imports livecoding
	poetry run black --line-length 120 livecoding

format: .venv
	poetry run flake8 --ignore E501,W503,E203 livecoding

.venv: poetry.lock
	poetry install

# Frontend
watch_front: node_modules
	node_modules/.bin/esbuild frontend/app.js --bundle --sourcemap --outfile=$(bundle_path) --watch

$(bundle_path): node_modules FORCE
	node_modules/.bin/esbuild frontend/app.js --minify --bundle --outfile=$(bundle_path)

metafile: node_modules FORCE
	# https://esbuild.github.io/analyze/
	node_modules/.bin/esbuild frontend/app.js --bundle --minify --metafile=frontend/public/meta.json --outfile=$(bundle_path)

node_modules: package.json package-lock.json
	npm install

clean:
	rm -rf node_modules
	rm $(bundle_path)
	rm -rf .venv

# Deployment scripts
push: build lint
	#ssh -T $(host) "mkdir -p ~/livecoding"
	rsync --delete --verbose --archive --compress --rsh=ssh $(deploy_files) $(host):~/livecoding

deploy: push
	ssh -T $(host) "systemctl --user restart livecoding.service"

stop-deploy:
	ssh -T $(host) "systemctl --user stop livecoding.service"

view-log:
	ssh -T $(host) "journalctl --user-unit=livecoding.service --no-pager | tail -n 30"

FORCE:

.PHONY: all build clean run lint watch_front clean deploy stop-deploy
