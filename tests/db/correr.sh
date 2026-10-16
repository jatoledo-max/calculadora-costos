#!/usr/bin/env bash
# Prueba supabase/schema.sql + supabase/caja.sql en una base Postgres de prueba, desde cero.
# caja.sql se corre dos veces para comprobar que se puede volver a correr sin romper nada.
# Uso: tests/db/correr.sh   (necesita psql y un Postgres; se configura con PGHOST, PGPORT, PGUSER)
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=caja_prueba
export PGOPTIONS="-c client_min_messages=warning"
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
for f in tests/db/supabase-stub.sql supabase/schema.sql supabase/caja.sql supabase/caja.sql tests/db/caja.test.sql; do
  psql -q -X -o /dev/null -v ON_ERROR_STOP=1 -d $DB -f "$f"
done

# Dos celulares mandan la MISMA venta a la vez: el segundo espera al primero y no la duplica.
COMO_A="set role authenticated; select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);"
VENTA="select public.confirmar_venta('99999999-0000-0000-0000-000000000009','[{\"producto\":\"mayo\",\"cantidad\":1,\"costo_unitario\":150}]','[{\"medio\":\"efectivo\",\"importe\":500}]')"
psql -X -q -o /dev/null -d $DB -c "begin" -c "$COMO_A" -c "$VENTA" -c "select pg_sleep(1.5)" -c "commit" &
sleep 0.5
psql -X -q -t -d $DB -c "$COMO_A" -c "$VENTA" | grep -q '"duplicada": true' || { echo "Concurrencia: la segunda venta no se reconoció como duplicada"; exit 1; }
wait
[ "$(psql -X -q -t -A -d $DB -c "select count(*) from public.ventas where id = '99999999-0000-0000-0000-000000000009'")" = 1 ] || { echo "Concurrencia: venta duplicada"; exit 1; }

echo "Pruebas de la base: OK"
