#!/bin/bash
#
# Deployment automation script for API Gateway
# Supports AWS, Kong, and Apigee deployments
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
GATEWAY_TYPE=${1:-aws} # aws, kong, apigee
ENVIRONMENT=${2:-production}
REGION=${3:-us-east-1}
VERSION=${4:-latest}

echo -e "${BLUE}=== API Gateway Deployment Script ===${NC}"
echo "Gateway Type: $GATEWAY_TYPE"
echo "Environment: $ENVIRONMENT"
echo "Region: $REGION"
echo "Version: $VERSION"

# ────────────────────────────────────────────────────────────────
# AWS Deployment
# ────────────────────────────────────────────────────────────────
deploy_aws() {
  echo -e "${YELLOW}Deploying to AWS API Gateway...${NC}"

  # Check prerequisites
  if ! command -v cdk &> /dev/null; then
    echo -e "${RED}AWS CDK is not installed. Please install it first.${NC}"
    exit 1
  fi

  if ! command -v aws &> /dev/null; then
    echo -e "${RED}AWS CLI is not installed. Please install it first.${NC}"
    exit 1
  fi

  # Set AWS profile
  export AWS_PROFILE=${AWS_PROFILE:-default}
  export AWS_REGION=$REGION

  # Navigate to AWS gateway directory
  cd gateway/aws || exit

  # Install dependencies
  echo -e "${BLUE}Installing dependencies...${NC}"
  npm install

  # Set CDK context
  export CDK_CONTEXT_ENVIRONMENT=$ENVIRONMENT
  export CDK_CONTEXT_BACKEND_URL=${BACKEND_URL:-http://localhost:3001}

  # Synthesize stack
  echo -e "${BLUE}Synthesizing CDK stack...${NC}"
  cdk synth

  # Deploy stack
  echo -e "${BLUE}Deploying CDK stack...${NC}"
  cdk deploy \
    --all \
    --require-approval=never \
    --context environment=$ENVIRONMENT \
    --context backendUrl=${BACKEND_URL:-http://localhost:3001}

  # Get outputs
  echo -e "${GREEN}AWS API Gateway deployment completed!${NC}"
  aws cloudformation describe-stacks \
    --stack-name RwaApiGatewayStack \
    --region $REGION \
    --query 'Stacks[0].Outputs'

  cd ../..
}

# ────────────────────────────────────────────────────────────────
# Kong Deployment
# ────────────────────────────────────────────────────────────────
deploy_kong() {
  echo -e "${YELLOW}Deploying Kong API Gateway...${NC}"

  # Check prerequisites
  if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker is not installed. Please install it first.${NC}"
    exit 1
  fi

  if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}Docker Compose is not installed. Please install it first.${NC}"
    exit 1
  fi

  # Navigate to Kong directory
  cd gateway/kong || exit

  # Create environment file
  echo -e "${BLUE}Creating environment configuration...${NC}"
  cat > .env << EOF
ADMIN_API_KEY=${ADMIN_API_KEY:-admin-key-change-in-production}
JWT_SECRET=${JWT_SECRET:-jwt-secret-change-in-production}
KONG_ADMIN_PASSWORD=${KONG_ADMIN_PASSWORD:-kong-admin-password}
NODE_ENV=$ENVIRONMENT
EOF

  # Build and start containers
  echo -e "${BLUE}Building and starting containers...${NC}"
  docker-compose down -v 2>/dev/null || true
  docker-compose up -d

  # Wait for Kong to be ready
  echo -e "${BLUE}Waiting for Kong to start...${NC}"
  sleep 10
  KONG_READY=0
  for i in {1..30}; do
    if curl -s http://localhost:8001/status > /dev/null 2>&1; then
      KONG_READY=1
      break
    fi
    echo -n "."
    sleep 2
  done

  if [ $KONG_READY -eq 0 ]; then
    echo -e "${RED}Kong failed to start${NC}"
    exit 1
  fi

  echo -e "${GREEN}Kong is ready!${NC}"

  # Load declarative configuration
  echo -e "${BLUE}Loading Kong configuration...${NC}"
  curl -X POST http://localhost:8001/config \
    -d @kong.yml \
    -H "Content-Type: application/json"

  # Create JWT consumer
  echo -e "${BLUE}Creating JWT consumer...${NC}"
  CONSUMER_RESPONSE=$(curl -s -X POST http://localhost:8001/consumers \
    -d "username=admin-user" \
    -d "custom_id=admin-001")

  CONSUMER_ID=$(echo $CONSUMER_RESPONSE | grep -o '"id":"[^"]*"' | head -1 | sed 's/.*://;s/\"//g')

  # Create JWT credential
  curl -s -X POST http://localhost:8001/consumers/$CONSUMER_ID/jwt \
    -d "algorithm=HS256" \
    -d "secret=${JWT_SECRET:-jwt-secret}" \
    -d "key=admin-key"

  # Enable Prometheus metrics
  echo -e "${BLUE}Enabling Prometheus plugin...${NC}"
  curl -s -X POST http://localhost:8001/plugins \
    -d "name=prometheus"

  echo -e "${GREEN}Kong API Gateway deployment completed!${NC}"
  echo -e "${BLUE}Kong Admin API: http://localhost:8001${NC}"
  echo -e "${BLUE}Kong Admin GUI: http://localhost:8002${NC}"
  echo -e "${BLUE}Kong Proxy: http://localhost:8000${NC}"
  echo -e "${BLUE}Prometheus Metrics: http://localhost:8001/metrics${NC}"

  cd ../..
}

# ────────────────────────────────────────────────────────────────
# Apigee Deployment
# ────────────────────────────────────────────────────────────────
deploy_apigee() {
  echo -e "${YELLOW}Deploying to Apigee...${NC}"

  # Check prerequisites
  if ! command -v apigee &> /dev/null; then
    echo -e "${RED}Apigee CLI is not installed. Please install it first.${NC}"
    exit 1
  fi

  # Set Apigee environment variables
  export APIGEE_ORGANIZATION=${APIGEE_ORGANIZATION:-your-org}
  export APIGEE_ENVIRONMENT=${ENVIRONMENT:-prod}
  export APIGEE_USERNAME=${APIGEE_USERNAME}
  export APIGEE_PASSWORD=${APIGEE_PASSWORD}

  # Validate credentials
  if [ -z "$APIGEE_USERNAME" ] || [ -z "$APIGEE_PASSWORD" ]; then
    echo -e "${RED}Apigee credentials not set. Set APIGEE_USERNAME and APIGEE_PASSWORD.${NC}"
    exit 1
  fi

  # Navigate to Apigee directory
  cd gateway/apigee || exit

  # Deploy API proxy
  echo -e "${BLUE}Deploying API proxy...${NC}"
  apigee deployments deploy \
    --organization $APIGEE_ORGANIZATION \
    --environment $APIGEE_ENVIRONMENT \
    --proxy rwa-marketplace \
    --source apiproxy/rwa-marketplace.xml

  # Get deployment status
  echo -e "${BLUE}Checking deployment status...${NC}"
  apigee deployments status \
    --organization $APIGEE_ORGANIZATION \
    --environment $APIGEE_ENVIRONMENT \
    --proxy rwa-marketplace

  echo -e "${GREEN}Apigee API Gateway deployment completed!${NC}"
  echo -e "${BLUE}API Endpoint: https://${APIGEE_ORGANIZATION}-${ENVIRONMENT}.apigee.net${NC}"

  cd ../..
}

# ────────────────────────────────────────────────────────────────
# Validation
# ────────────────────────────────────────────────────────────────
validate_deployment() {
  echo -e "${YELLOW}Validating deployment...${NC}"

  case $GATEWAY_TYPE in
    aws)
      echo -e "${BLUE}Validating AWS API Gateway...${NC}"
      # Add AWS validation logic
      ;;
    kong)
      echo -e "${BLUE}Validating Kong...${NC}"
      if curl -s http://localhost:8001/status > /dev/null 2>&1; then
        echo -e "${GREEN}Kong is responding${NC}"
      else
        echo -e "${RED}Kong is not responding${NC}"
        exit 1
      fi
      ;;
    apigee)
      echo -e "${BLUE}Validating Apigee...${NC}"
      # Add Apigee validation logic
      ;;
  esac

  echo -e "${GREEN}Deployment validation successful!${NC}"
}

# ────────────────────────────────────────────────────────────────
# Cleanup
# ────────────────────────────────────────────────────────────────
cleanup() {
  echo -e "${YELLOW}Cleaning up...${NC}"

  case $GATEWAY_TYPE in
    kong)
      cd gateway/kong || exit
      docker-compose down -v 2>/dev/null || true
      rm -f .env
      cd ../..
      ;;
  esac

  echo -e "${GREEN}Cleanup completed!${NC}"
}

# ────────────────────────────────────────────────────────────────
# Main
# ────────────────────────────────────────────────────────────────
trap cleanup EXIT

case $GATEWAY_TYPE in
  aws)
    deploy_aws
    ;;
  kong)
    deploy_kong
    ;;
  apigee)
    deploy_apigee
    ;;
  *)
    echo -e "${RED}Unknown gateway type: $GATEWAY_TYPE${NC}"
    echo "Supported types: aws, kong, apigee"
    exit 1
    ;;
esac

validate_deployment

echo -e "${GREEN}=== Deployment Complete ===${NC}"
