#!/usr/bin/env bash
set -e

# Change directory to project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

echo "================================================================================"
echo "CDMS - CHANGE DATA MANAGEMENT SERVICE AUTOMATED TEST & DEMO"
echo "================================================================================"

# Check Python environment
if [ -d ".venv" ]; then
    echo "Using virtual environment .venv"
    PYTHON_BIN=".venv/bin/python3"
else
    PYTHON_BIN="python3"
fi

# Run the test script
$PYTHON_BIN scripts/demo_test.py
