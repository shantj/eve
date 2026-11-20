#!/bin/zsh
cd "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'; then
  echo '请先安装 Node.js 20 或更高版本。'; read -k 1; exit 1
fi
if [[ ! -d node_modules/ajv || ! -d node_modules/fflate || ! -d node_modules/@resvg/resvg-js || ! -d node_modules/pngjs || ! -d node_modules/imapflow ]]; then npm ci || { read -k 1; exit 1; }; fi
exec node bin/desk-launch.mjs
