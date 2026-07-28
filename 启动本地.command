#!/bin/zsh
set -e
cd "${0:A:h}"
echo "PaperCut Studio 本地启动器"
echo "项目目录：$PWD"
npm run open
