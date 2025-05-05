#!/bin/sh

# Create dist directory if it doesn't exist
mkdir -p dist

# Copy index.html to dist
echo "Copying index.html to dist..."
cp -f index.html dist/

# Create public directory in dist
mkdir -p dist/public

# Create public directory in dist regardless of whether source exists
mkdir -p dist/public

# Copy public directory contents if they exist
if [ -d "public" ] && [ "$(ls -A public 2>/dev/null)" ]; then
    echo "Copying public directory contents..."
    cp -rf public/. dist/public/
else
    echo "No public directory contents to copy, but created empty directory"
    # Create an empty .gitkeep file to ensure the directory exists
    touch dist/public/.gitkeep
fi

# Ensure index.js is in the correct location
if [ -f "dist/src/index.js" ] && [ ! -f "dist/index.js" ]; then
    echo "Copying index.js from dist/src/ to dist/..."
    cp -f dist/src/index.js dist/index.js
fi

echo "Static file copy complete!"