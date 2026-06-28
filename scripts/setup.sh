#!/bin/bash

# Tokenized Fractional RWA Marketplace Setup Script
# This script automates the local development environment setup.

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================================================${NC}"
echo -e "${BLUE}   🚀 Starting Local Development Setup for Tokenized RWA    ${NC}"
echo -e "${BLUE}================================================================${NC}"

# Function to print status
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 1. Check Prerequisites
print_status "Checking prerequisites..."

# Check for curl
if ! command -v curl &> /dev/null; then
    print_error "curl is not installed. Please install curl and try again."
    exit 1
fi

# Check for Node.js
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js (v18 or higher) and try again."
    exit 1
else
    NODE_VERSION=$(node -v)
    print_success "Node.js installed: $NODE_VERSION"
fi

# 2. Install Rust Toolchain
if ! command -v rustc &> /dev/null; then
    print_status "Rust not found. Installing Rust toolchain..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source $HOME/.cargo/env
    print_success "Rust toolchain installed successfully."
else
    print_success "Rust is already installed: $(rustc --version)"
fi

# 3. Install Soroban CLI & WASM Target
print_status "Ensuring WASM target is installed..."
rustup target add wasm32-unknown-unknown

if ! command -v soroban &> /dev/null; then
    print_status "Installing Soroban CLI (this may take a few minutes)..."
    cargo install --locked soroban-cli
    print_success "Soroban CLI installed successfully."
else
    print_success "Soroban CLI is already installed."
fi

# 4. Install Node.js Dependencies
print_status "Installing Node.js dependencies..."

if [ -d "backend" ]; then
    echo "Installing backend dependencies..."
    (cd backend && npm install)
    print_success "Backend dependencies installed."
fi

if [ -d "frontend" ]; then
    echo "Installing frontend dependencies..."
    (cd frontend && npm install)
    print_success "Frontend dependencies installed."
fi

# 5. Create .env Files from Examples
print_status "Configuring environment variables..."

if [ -f "backend/.env.example" ]; then
    if [ ! -f "backend/.env" ]; then
        cp backend/.env.example backend/.env
        print_success "Created backend/.env from example."
    else
        print_warning "backend/.env already exists, skipping."
    fi
fi

if [ -f "frontend/.env.example" ]; then
    if [ ! -f "frontend/.env" ]; then
        cp frontend/.env.example frontend/.env
        print_success "Created frontend/.env from example."
    else
        print_warning "frontend/.env already exists, skipping."
    fi
fi

# 6. Build the Contract
print_status "Building the Soroban smart contract..."
if [ -d "contracts" ]; then
    (cd contracts && cargo build --target wasm32-unknown-unknown --release)
    print_success "Contract built successfully."
else
    print_error "contracts directory not found. Build failed."
    exit 1
fi

# Final Next Steps
echo -e "\n${BLUE}================================================================${NC}"
echo -e "${GREEN}✅ Setup Complete!${NC}"
echo -e "${BLUE}================================================================${NC}"
echo -e "To get the project running, follow these steps:\n"
echo -e "1. ${YELLOW}Configure your environment variables:${NC}"
echo -e "   - Edit ${BLUE}backend/.env${NC} (set your ADMIN_API_KEY)"
echo -e "   - Edit ${BLUE}frontend/.env${NC} (add your CONTRACT_ID after deployment)\n"
echo -e "2. ${YELLOW}Deploy the contract to Testnet:${NC}"
echo -e "   - See README.md 'Configure Testnet & Deploy' section\n"
echo -e "3. ${YELLOW}Run the backend:${NC}"
echo -e "   ${BLUE}cd backend && npm run dev${NC}\n"
echo -e "4. ${YELLOW}Run the frontend:${NC}"
echo -e "   ${BLUE}cd frontend && npm run dev${NC}\n"
echo -e "Open http://localhost:5173 and connect your Freighter wallet."
echo -e "${BLUE}================================================================${NC}"
