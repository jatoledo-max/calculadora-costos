-- Pruebas de compras.sql. Usa los negocios de caja.test.sql: A = Venutto, B = Otro, C = Vencido (prueba terminada).
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
insert into public.compras (id, negocio_id, fecha, categoria, descripcion, importe, cantidad, unidad, estimada)
values ('c1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', '2026-11-02', 'Carnicería', 'Nalga', 21000, 1.75, 'kg', true);
-- Reintento: no duplica.
insert into public.compras (id, negocio_id, fecha, categoria, descripcion, importe)
values ('c1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', '2026-11-02', 'Carnicería', 'Nalga', 21000) on conflict do nothing;
do $$ begin
  if (select count(*) from public.compras) <> 1 then raise exception 'A debería ver 1 compra'; end if;
  begin
    insert into public.compras (id, negocio_id, fecha, categoria, descripcion, importe)
    values ('c1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b', '2026-11-02', 'Otros', 'X', 1);
    raise exception 'A pudo cargar una compra en el negocio de B';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.compras (id, negocio_id, fecha, categoria, descripcion, importe)
    values ('c1000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a', '2026-11-02', 'Otros', ' ', 1);
    raise exception 'Se guardó una compra sin descripción';
  exception when check_violation then null; end;
  begin
    insert into public.compras (id, negocio_id, fecha, categoria, descripcion, importe, cantidad)
    values ('c1000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-00000000000a', '2026-11-02', 'Otros', 'Gas', 1, 2);
    raise exception 'Se guardó una cantidad sin unidad';
  exception when check_violation then null; end;
end $$;

select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$ begin
  if (select count(*) from public.compras) <> 0 then raise exception 'B ve compras de A'; end if;
  delete from public.compras;
end $$;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', false);
do $$ begin
  begin
    insert into public.compras (id, negocio_id, fecha, categoria, descripcion, importe)
    values ('c1000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-00000000000c', '2026-11-02', 'Otros', 'X', 1);
    raise exception 'Un negocio con la prueba vencida pudo cargar compras';
  exception when insufficient_privilege then null; end;
end $$;
set role anon;
do $$ begin
  perform 1 from public.compras;
  raise exception 'anon puede leer compras';
exception when insufficient_privilege then null; end $$;

reset role;
do $$ begin
  if (select count(*) from public.compras) <> 1 then raise exception 'B borró la compra de A'; end if;
end $$;
-- A la borra.
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
delete from public.compras where id = 'c1000000-0000-0000-0000-000000000001';
reset role;
do $$ begin if (select count(*) from public.compras) <> 0 then raise exception 'A no pudo borrar su compra'; end if; end $$;
