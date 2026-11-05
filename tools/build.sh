#!/bin/sh
# Збирає сайт у папку build/ (для Netlify: npm run build, publish = build).
set -e
cd "$(dirname "$0")/.."
sh tools/build-env.sh
rm -rf build
mkdir build
cp -r index.html robots.txt .nojekyll css js build/
rm -f build/js/env.example.js
echo "Сайт зібрано в папку build/"
