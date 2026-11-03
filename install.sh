#!/bin/bash
# Todu Fit installer
# Usage: curl -fsSL https://raw.githubusercontent.com/evcraddock/todu-fit/main/install.sh | bash

set -e

REPO="evcraddock/todu-fit"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"

# Detect OS and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
    linux)
        case "$ARCH" in
            x86_64) TARGET="x86_64-unknown-linux-gnu" ;;
            *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
        esac
        ;;
    darwin)
        case "$ARCH" in
            x86_64) echo "Pre-built macOS binaries require Apple Silicon. Run this installer from a native arm64 shell."; exit 1 ;;
            arm64) TARGET="aarch64-apple-darwin" ;;
            *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
        esac
        ;;
    *)
        echo "Unsupported OS: $OS"
        echo "For Windows, download from: https://github.com/$REPO/releases"
        exit 1
        ;;
esac

# Get latest release version
echo "Fetching latest release..."
LATEST=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$LATEST" ]; then
    echo "Failed to fetch latest release"
    exit 1
fi

echo "Installing Todu Fit $LATEST for $TARGET..."

# Download and extract
URL="https://github.com/$REPO/releases/download/$LATEST/todu-fit-$TARGET.tar.gz"
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

curl -fsSL "$URL" -o "$TEMP_DIR/todu-fit.tar.gz"
tar -xzf "$TEMP_DIR/todu-fit.tar.gz" -C "$TEMP_DIR"

# Install
mkdir -p "$INSTALL_DIR"
mv "$TEMP_DIR/fit" "$INSTALL_DIR/fit"
chmod +x "$INSTALL_DIR/fit"

echo ""
echo "✓ Installed fit to $INSTALL_DIR/fit"

# Check if in PATH
if ! echo "$PATH" | grep -q "$INSTALL_DIR"; then
    echo ""
    echo "Note: $INSTALL_DIR is not in your PATH."
    echo "Add it with:"
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
fi

echo ""
echo "Run 'fit --help' to get started."
