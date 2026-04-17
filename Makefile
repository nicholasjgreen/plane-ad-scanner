.PHONY: start stop logs dev scan rescore test coverage build lint lint-fix clear-listings reset-sites reset-indicators derive-indicators help

IMAGE := plane-ad-scanner-test

## Start the server + scheduler (background)
start:
	docker compose up -d --build

## Stop everything
stop:
	docker compose down

## Tail live logs
logs:
	docker compose logs -f app

## Live-reload dev mode (syncs src/ on save, streams app logs)
dev:
	docker compose up -d --build
	docker compose watch & docker compose logs -f app

## Run a one-off scan
scan:
	docker compose run --rm --build scan

## Re-score all listings without re-scraping
rescore:
	docker compose run --rm --build rescore

## Run the test suite
test:
	docker build -t $(IMAGE) . && docker run --rm $(IMAGE) npm run _test

## Run tests with coverage report (writes to ./coverage/)
coverage:
	docker build -t $(IMAGE) .
	docker run --name coverage-tmp $(IMAGE) npm run test:coverage; \
	  mkdir -p ./coverage && docker cp coverage-tmp:/app/coverage/. ./coverage; \
	  docker rm coverage-tmp; \
	  echo "HTML report: ./coverage/index.html"

## Type-check (tsc --noEmit)
build:
	docker build -t $(IMAGE) . && docker run --rm $(IMAGE) npm run _build

## Lint
lint:
	docker build -t $(IMAGE) . && docker run --rm $(IMAGE) npm run _lint

## Lint and auto-fix
lint-fix:
	docker build -t $(IMAGE) . && docker run --rm $(IMAGE) npm run _lint:fix

## Delete all listings, scan runs, scores, AI content, and indicators from the DB
clear-listings:
	docker compose run --rm --build scan npm run clear-listings

## Reset site scan metadata (last_scan_outcome, last_verified, total_listings) without removing sites
reset-sites:
	docker compose run --rm --build scan npm run reset-sites

## Reset all listing_indicators to pending so the next scan re-derives structured features
reset-indicators:
	docker compose run --rm --build scan npm run reset-indicators

## Re-run the indicator deriver on all pending/stale listings (no full scan needed)
## Pass LIMIT=N to process only N listings, e.g: make derive-indicators LIMIT=3
derive-indicators:
	docker compose run --rm --build scan npm run derive-indicators -- $(LIMIT)

## Show this help
help:
	@grep -E '^##' Makefile | sed 's/## //'
