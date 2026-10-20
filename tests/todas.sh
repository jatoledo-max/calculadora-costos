#!/usr/bin/env bash
# Corre TODAS las pruebas: cuentas (node --test), base de datos (Postgres) y pantallas (Playwright, modo demo).
# Uso: tests/todas.sh   (necesita Node 22, psql + Postgres con PGHOST/PGPORT/PGUSER, y Playwright;
#      PLAYWRIGHT y CHROMIUM pueden indicar dónde están Playwright y el navegador)
set -uo pipefail
cd "$(dirname "$0")/.."
fallas=()
correr() { local nombre="$1"; shift; echo "▶ $nombre"; if "$@"; then echo "  OK"; else echo "  FALLÓ"; fallas+=("$nombre"); fi; }

correr "Cuentas (npm test)" npm test --silent
correr "Base de datos" tests/db/correr.sh

# Servidor de la app para las pruebas de pantalla (celular.e2e.cjs levanta el suyo).
(cd public && exec npx -y http-server -p 8765 -s -c-1 .) >/dev/null 2>&1 &
SERVIDOR=$!
trap 'kill $SERVIDOR 2>/dev/null' EXIT
for i in $(seq 1 30); do curl -s -o /dev/null http://localhost:8765/ && break; sleep 0.5; done
for t in caja cierre informes ficha menu-calc celular integral; do
  correr "Pantalla: $t" node "tests/e2e/$t.e2e.cjs"
done

echo
if [ ${#fallas[@]} -eq 0 ]; then echo "Todas las pruebas: OK"; else echo "Fallaron: ${fallas[*]}"; exit 1; fi
