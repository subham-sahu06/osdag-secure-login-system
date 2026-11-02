#!/bin/bash
echo "Starting production deployment..."
git pull origin main
docker-compose down
docker-compose up -d --build
docker-compose exec -T web pytest
echo "Deployment successful!"
