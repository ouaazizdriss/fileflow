.PHONY: build frontend backend image up down clean

## Build everything on the host, then package into Docker
build: frontend backend

frontend:
	cd frontend && npx -y pnpm@10 install --frozen-lockfile && npx -y pnpm@10 run build

backend:
	cd backend && cargo build --release

## Build the Docker image (requires 'make build' first)
image: build
	docker build -t fileflow:latest .

## Full workflow: build artifacts + docker image + start container
up: image
	docker compose up -d
	@echo ""
	@echo "FileFlow is running at http://localhost:8080"

down:
	docker compose down

## Rebuild and restart
deploy: image
	docker compose up -d --force-recreate

clean:
	rm -rf frontend/dist frontend/node_modules
	cd backend && cargo clean
