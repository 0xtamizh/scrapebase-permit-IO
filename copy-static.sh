#!/bin/bash

# Create dist directory if it doesn't exist
mkdir -p dist

# Copy index.html to dist
echo "Copying index.html to dist..."
cp -f index.html dist/

# Create public directory in dist
mkdir -p dist/public

# Copy public directory contents if they exist
if [ -d "public" ] && [ "$(ls -A public 2>/dev/null)" ]; then
    echo "Copying public directory contents..."
    cp -rf public/. dist/public/
else
    echo "No public directory contents to copy"
fi

echo "Static file copy complete!" 