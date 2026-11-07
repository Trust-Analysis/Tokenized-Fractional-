#!/usr/bin/env bash

# Tokenized Fractional RWA Marketplace Setup Script
# This script automates the local development environment setup.

set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
NODE_VERSION="$(cat "$REPO_ROOT/.nvmrc" 2>/dev/null || printf '20')"
CONFIGURE_GIT=false
FORCE_GIT=false
cd "$REPO_ROOT"

for argument in "$@"; do
    case "$argument" in
        --configure-git) CONFIGURE_GIT=true ;;
        --force-git) FORCE_GIT=true ;;
        --help|-h)
            printf 'Usage: %s [--configure-git] [--force-git]\n' "$0"
            printf '  --configure-git  Configure origin/upstream for the Trust Analysis SSH alias.\n'
            printf '  --force-git      Replace existing origin/upstream URLs when configuring Git.\n'
            exit 0
            ;;
        *) printf 'Unknown option: %s\n' "$argument" >&2; exit 1 ;;
    esac
done

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

printf '%b\n' "${BLUE}================================================================${NC}"
printf '%b\n' "${BLUE}   Starting Local Development Setup for Tokenized RWA          ${NC}"
printf '%b\n' "${BLUE}================================================================${NC}"

# Function to print status
print_status() {
    printf '%b\n' "${BLUE}[INFO]${NC} $1"
}

print_success() {
    printf '%b\n' "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    printf '%b\n' "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    printf '%b\n' "${RED}[ERROR]${NC} $1" >&2
}

if [[ "$(uname -s)" != "Linux" ]]; then
    print_error "This script supports Linux only. Use scripts/setup.ps1 on Windows."
    exit 1
fi

if command -v apt-get >/dev/null 2>&1; then
    if [[ "${EUID}" -eq 0 ]]; then
        SUDO=''
    elif command -v sudo >/dev/null 2>&1; then
        SUDO=sudo
    else
        print_error "sudo is required to install Linux packages."
        exit 1
    fi

    print_status "Installing Linux prerequisites..."
    $SUDO apt-get update
    $SUDO apt-get install -y ca-certificates curl gnupg git build-essential docker.io
    $SUDO systemctl enable --now docker 2>/dev/null || print_warning "Docker service could not be started automatically."
else
    print_error "This script requires apt-get (Ubuntu/Debian). Install curl, git, Docker, and build tools manually on other distributions."
    exit 1
fi

if ! id -nG "${USER}" | tr ' ' '\n' | grep -qx docker; then
    $SUDO usermod -aG docker "${USER}" 2>/dev/null || print_warning "Could not add ${USER} to the docker group."
    print_warning "Log out and back in before using Docker without sudo."
fi

if ! command -v terraform >/dev/null 2>&1; then
    print_status "Installing Terraform CLI..."
    $SUDO install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://apt.releases.hashicorp.com/gpg | $SUDO gpg --dearmor --yes -o /etc/apt/keyrings/hashicorp-archive-keyring.gpg
    printf '%s\n' "deb [signed-by=/etc/apt/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(. /etc/os-release && printf '%s' "$VERSION_CODENAME") main" | $SUDO tee /etc/apt/sources.list.d/hashicorp.list >/dev/null
    $SUDO apt-get update
    $SUDO apt-get install -y terraform
fi
print_success "Terraform CLI available: $(terraform version -json | sed -n 's/.*"terraform_version":"\([^"]*\)".*/\1/p')"

# 1. Install Node.js through nvm so contributors can use the repository version.
print_status "Ensuring Node.js ${NODE_VERSION} is available..."
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
fi
# shellcheck source=/dev/null
source "$NVM_DIR/nvm.sh"
nvm install "$NODE_VERSION"
nvm alias default "$NODE_VERSION"
nvm use "$NODE_VERSION" >/dev/null
print_success "Node.js installed: $(node --version)"

print_success "Docker available: $(docker --version)"

configure_git() {
    local ssh_remote='git@Alhaji-naira:Trust-Analysis/Tokenized-Fractional-.git'
    if [[ "$CONFIGURE_GIT" != true ]]; then
        return
    fi
    for remote_name in origin upstream; do
        if git remote get-url "$remote_name" >/dev/null 2>&1; then
            if [[ "$FORCE_GIT" == true ]]; then
                git remote set-url "$remote_name" "$ssh_remote"
            else
                print_warning "Keeping existing $remote_name remote. Use --force-git to replace it."
            fi
        elif [[ "$remote_name" == origin ]]; then
            git remote add origin "$ssh_remote"
        fi
    done
    print_success "Git remote routing uses SSH alias Alhaji-naira."
}

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

configure_git

# Final Next Steps
printf '\n%b\n' "${BLUE}================================================================${NC}"
printf '%b\n' "${GREEN}Setup Complete!${NC}"
printf '%b\n' "${BLUE}================================================================${NC}"
printf '%b\n' "Edit backend/.env and frontend/.env, then run:"
printf '%b\n' "  (cd backend && npm run dev)"
printf '%b\n' "  (cd frontend && npm run dev)"
