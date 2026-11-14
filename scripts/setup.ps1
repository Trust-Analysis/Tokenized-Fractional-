# Tokenized Fractional RWA Marketplace Setup Script
# This script automates the local development environment setup for Windows.

$ErrorActionPreference = "Stop"

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "   🚀 Starting Local Development Setup for Tokenized RWA    " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

function Write-Status($msg) { Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-Success($msg) { Write-Host "[SUCCESS] $msg" -ForegroundColor Green }
function Write-Warning($msg) { Write-Host "[WARNING] $msg" -ForegroundColor Yellow }
function Write-ErrorMsg($msg) { Write-Host "[ERROR] $msg" -ForegroundColor Red }

# 1. Check Prerequisites
Write-Status "Checking prerequisites..."

# Check for Node.js
if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-ErrorMsg "Node.js is not installed. Please install Node.js (v18 or higher) and try again."
    exit 1
} else {
    $nodeVersion = node -v
    Write-Success "Node.js installed: $nodeVersion"
}

# Check for curl
if (!(Get-Command curl -ErrorAction SilentlyContinue)) {
    Write-ErrorMsg "curl is not installed. Please install curl and try again."
    exit 1
}

# 2. Install Rust Toolchain
if (!(Get-Command rustc -ErrorAction SilentlyContinue)) {
    Write-Status "Rust not found. Installing Rust toolchain..."
    # Download and run rustup-init.exe
    $rustupInstaller = "$env:TEMP\rustup-init.exe"
    Invoke-WebRequest -Uri "https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe" -OutFile $rustupInstaller
    Start-Process -FilePath $rustupInstaller -ArgumentList "-y" -Wait
    
    # Update PATH for current session
    $env:Path += ";$env:USERPROFILE\.cargo\bin"
    Write-Success "Rust toolchain installed successfully."
} else {
    Write-Success "Rust is already installed: $(rustc --version)"
}

# 3. Install Soroban CLI & WASM Target
Write-Status "Ensuring WASM target is installed..."
rustup target add wasm32-unknown-unknown

if (!(Get-Command soroban -ErrorAction SilentlyContinue)) {
    Write-Status "Installing Soroban CLI (this may take a few minutes)..."
    cargo install --locked soroban-cli
    Write-Success "Soroban CLI installed successfully."
} else {
    Write-Success "Soroban CLI is already installed."
}

# 4. Install Node.js Dependencies
Write-Status "Installing Node.js dependencies..."

if (Test-Path "backend") {
    Write-Host "Installing backend dependencies..."
    Push-Location backend
    npm install
    Pop-Location
    Write-Success "Backend dependencies installed."
}

if (Test-Path "frontend") {
    Write-Host "Installing frontend dependencies..."
    Push-Location frontend
    npm install
    Pop-Location
    Write-Success "Frontend dependencies installed."
}

# 5. Create .env Files from Examples
Write-Status "Configuring environment variables..."

if (Test-Path "backend\.env.example") {
    if (!(Test-Path "backend\.env")) {
        Copy-Item "backend\.env.example" "backend\.env"
        Write-Success "Created backend/.env from example."
    } else {
        Write-Warning "backend/.env already exists, skipping."
    }
}

if (Test-Path "frontend\.env.example") {
    if (!(Test-Path "frontend\.env")) {
        Copy-Item "frontend\.env.example" "frontend\.env"
        Write-Success "Created frontend/.env from example."
    } else {
        Write-Warning "frontend/.env already exists, skipping."
    }
}

# 6. Build the Contract
Write-Status "Building the Soroban smart contract..."
if (Test-Path "contracts") {
    Push-Location contracts
    cargo build --target wasm32-unknown-unknown --release
    Pop-Location
    Write-Success "Contract built successfully."
} else {
    Write-ErrorMsg "contracts directory not found. Build failed."
    exit 1
}

# Final Next Steps
Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "✅ Setup Complete!" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "To get the project running, follow these steps:`n"
Write-Host "1. Configure your environment variables:" -ForegroundColor Yellow
Write-Host "   - Edit backend/.env (set your ADMIN_API_KEY)"
Write-Host "   - Edit frontend/.env (add your CONTRACT_ID after deployment)`n"
Write-Host "2. Deploy the contract to Testnet:" -ForegroundColor Yellow
Write-Host "   - See README.md 'Configure Testnet & Deploy' section`n"
Write-Host "3. Run the backend:" -ForegroundColor Yellow
Write-Host "   cd backend; npm run dev`n"
Write-Host "4. Run the frontend:" -ForegroundColor Yellow
Write-Host "   cd frontend; npm run dev`n"
Write-Host "Open http://localhost:5173 and connect your Freighter wallet."
Write-Host "================================================================" -ForegroundColor Cyan
