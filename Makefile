# Nice guide
# https://www.olioapps.com/blog/the-lost-art-of-the-makefile

host := livecoding
bundle_path := frontend/public/bundle.js
deploy_files := livecoding frontend poetry.toml README.md poetry.lock pyproject.toml

all: build

build: .venv $(bundle_path)

run: .venv $(bundle_path)
	poetry run python -m livecoding.main

lint: .venv
	poetry run mypy --check-untyped-defs --ignore-missing-imports livecoding

.venv: poetry.lock
	poetry install

# Frontend
watch_front: node_modules
	node_modules/.bin/esbuild frontend/app.js --bundle --sourcemap --outfile=$(bundle_path) --watch

$(bundle_path): node_modules
	node_modules/.bin/esbuild frontend/app.js --minify --bundle --outfile=$(bundle_path)

node_modules: package.json package-lock.json
	npm install

clean:
	rm -rf node_modules
	rm -rf static/dist
	rm -rf .venv

# Deployment scripts
push: build lint
	#ssh -T $(host) "mkdir -p ~/livecoding"
	rsync --delete --verbose --archive --compress --rsh=ssh $(deploy_files) $(host):~/livecoding

deploy: push
	ssh -T $(host) "systemctl --user restart livecoding.service"
	ssh -T $(host) "journalctl --user-unit=livecoding.service --no-pager | tail -n 20"

stop-deploy:
	ssh -T $(host) "systemctl --user stop livecoding.service"
	ssh -T $(host) "journalctl --user-unit=livecoding.service --no-pager | tail -n 20"

.PHONY: all build clean run lint watch_front clean deploy stop-deploy
