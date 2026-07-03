.PHONY: up down build logs psql test reset-db

up:
	docker compose up -d

down:
	docker compose down

build:
	docker compose build

logs:
	docker compose logs -f

psql:
	docker compose exec postgres psql -U amparo amparo_mvp

test-unit:
	@for dir in gateway worker-stt worker-orchestrator worker-search worker-sender; do \
		echo "=== Testing $$dir ==="; \
		cd $$dir && npm test && cd ..; \
	done

test:
	npm --prefix gateway test && \
	npm --prefix worker-stt test && \
	npm --prefix worker-orchestrator test && \
	npm --prefix worker-search test && \
	npm --prefix worker-sender test

reset-db:
	docker compose exec postgres psql -U amparo -d amparo_mvp -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
	cat database/migrations/*.sql | docker compose exec -T postgres psql -U amparo amparo_mvp

logs-gateway:
	docker compose logs -f gateway

logs-orchestrator:
	docker compose logs -f worker-orchestrator
