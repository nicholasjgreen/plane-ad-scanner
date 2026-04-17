.PHONY: start stop logs dev scan rescore test build lint lint-fix clear-listings reset-sites help

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

## Live-reload dev mode (syncs src/ on save)
dev:
	docker compose watch

## Run a one-off scan
scan:
	docker compose run --rm --build scan

## Re-score all listings without re-scraping
rescore:
	docker compose run --rm --build rescore

## Run the test suite
test:
	docker build -t $(IMAGE) . && docker run --rm $(IMAGE) npm run _test

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

## Show this help
help:
	@grep -E '^##' Makefile | sed 's/## //'
