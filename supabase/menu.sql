-- Menú público de pedidos (Venutto Pedidos).
-- Pegar entero en Supabase > SQL Editor y correr (se puede correr más de una vez; no borra nada).
-- Necesita schema.sql. No cambia ninguna tabla: lee productos y ajustes, que se editan desde la calculadora.
--
-- La calculadora es la ÚNICA fuente de precios. El menú de los clientes lee de acá, sin login,
-- solo lo que se autorizó para vender:
--   menu_publico(slug)           → catálogo para mostrar (nombre, precio, foto, opciones, si está agotado)
--   cotizar_pedido(slug, items, entrega) → recalcula el pedido con los precios vigentes de la base
-- Nunca devuelven recetas, insumos, costos, márgenes ni datos de la caja.
--
-- Qué se publica:
--   ajustes id 'menu' (Mi negocio > Menú de pedidos):
--     { publicado, slug, whatsapp, alias, pagos: ["efectivo","transferencia","dividido"],
--       envio, horarios: { dias: [0..6], desde: "21:00", hasta: "01:00" }, aviso }
--   en cada producto (ficha > En el menú):
--     enMenu (true para mostrarlo), agotado, descripcion, plural, foto (URL pública)

-- Un slug (la "dirección" del menú) es de un solo negocio.
create unique index if not exists ajustes_menu_slug on public.ajustes ((lower(datos->>'slug'))) where id = 'menu';

-- Lo que el cliente puede ver de un producto. Lista cerrada de campos: lo que no está acá no sale.
create or replace function public.menu_producto(id text, d jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'id', id,
    'nombre', btrim(d->>'nombre'),
    'plural', nullif(btrim(coalesce(d->>'plural', '')), ''),
    'descripcion', nullif(btrim(coalesce(d->>'descripcion', '')), ''),
    'foto', case when coalesce(d->>'foto', '') ~ '^https://' then d->>'foto' end,
    'tipo', case when d->>'tipo' in ('promo', 'extra') then d->>'tipo' else 'producto' end,
    'categoria', coalesce(nullif(btrim(coalesce(d->>'categoria', '')), ''),
                   case d->>'tipo' when 'promo' then 'Promos' when 'extra' then 'Extras' else 'Otros' end),
    'precio', round((d->>'precioVenta')::numeric, 2),
    'disponible', not coalesce((d->>'agotado')::boolean, false),
    'opciones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o->>'id',
        'nombre', btrim(o->>'nombre'),
        'precio_extra', round(greatest(coalesce((o->>'precioExtra')::numeric, 0), 0), 2)) order by n)
      from jsonb_array_elements(case when jsonb_typeof(d->'opciones') = 'array' then d->'opciones' else '[]' end)
           with ordinality as x(o, n)
      where coalesce(btrim(o->>'nombre'), '') <> '' and coalesce(o->>'id', '') <> ''), '[]'::jsonb)
  );
$$;

-- ¿Este producto se vende en el menú? Tiene que estar marcado, tener nombre y precio, y no ser una preparación.
create or replace function public.menu_vendible(d jsonb)
returns boolean language sql immutable as $$
  select coalesce((d->>'enMenu')::boolean, false)
     and not coalesce((d->>'esPreparacion')::boolean, false)
     and coalesce(btrim(d->>'nombre'), '') <> ''
     and coalesce(d->>'precioVenta', '') ~ '^\d+(\.\d+)?$'
     and (d->>'precioVenta')::numeric > 0;
$$;

-- El negocio de un slug, solo si el menú está publicado y el negocio está activo (prueba o suscripción).
create or replace function public.menu_negocio(p_slug text)
returns table (negocio_id uuid, menu jsonb) language sql stable security definer set search_path = public as $$
  select n.id, a.datos
  from public.ajustes a join public.negocios n on n.id = a.negocio_id
  where a.id = 'menu' and lower(a.datos->>'slug') = lower(btrim(p_slug))
    and coalesce((a.datos->>'publicado')::boolean, false) and public.negocio_activo(n);
$$;
revoke all on function public.menu_negocio(text) from public, anon, authenticated;

create or replace function public.menu_config(m jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'whatsapp', regexp_replace(coalesce(m->>'whatsapp', ''), '\D', '', 'g'),
    'alias', nullif(btrim(coalesce(m->>'alias', '')), ''),
    'pagos', coalesce((select jsonb_agg(x.p) from jsonb_array_elements_text(
               case when jsonb_typeof(m->'pagos') = 'array' then m->'pagos' else '[]' end) x(p)
             where x.p in ('efectivo', 'transferencia', 'dividido')), '[]'::jsonb),
    'envio', case when coalesce(m->>'envio', '') ~ '^\d+(\.\d+)?$' then round((m->>'envio')::numeric, 2) end,
    'horarios', case when jsonb_typeof(m->'horarios') = 'object' then jsonb_build_object(
                  'dias', coalesce((select jsonb_agg(distinct x.d::int) from jsonb_array_elements_text(
                            case when jsonb_typeof(m->'horarios'->'dias') = 'array' then m->'horarios'->'dias' else '[]' end) x(d)
                          where x.d ~ '^[0-6]$'), '[]'::jsonb),
                  'desde', case when m->'horarios'->>'desde' ~ '^\d\d:\d\d$' then m->'horarios'->>'desde' end,
                  'hasta', case when m->'horarios'->>'hasta' ~ '^\d\d:\d\d$' then m->'horarios'->>'hasta' end) end,
    'aviso', nullif(btrim(coalesce(m->>'aviso', '')), '')
  );
$$;

-- Catálogo público. Si el slug no existe o el menú no está publicado devuelve null (el menú lo avisa).
create or replace function public.menu_publico(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  neg uuid; m jsonb; n public.negocios; prods jsonb;
begin
  select x.negocio_id, x.menu into neg, m from public.menu_negocio(p_slug) x;
  if neg is null then return null; end if;
  select * into n from public.negocios where id = neg;
  select coalesce(jsonb_agg(public.menu_producto(p.id, p.datos) order by lower(p.datos->>'nombre')), '[]'::jsonb) into prods
  from public.productos p where p.negocio_id = neg and public.menu_vendible(p.datos);
  return jsonb_build_object(
    'negocio', jsonb_build_object('nombre', n.nombre, 'logo', n.logo, 'color', n.color),
    'menu', public.menu_config(m),
    'productos', prods,
    -- Cambia cuando cambia cualquier cosa publicada: el menú lo usa para saber si hay precios nuevos.
    'version', md5(prods::text || public.menu_config(m)::text),
    'leido_en', now()
  );
end $$;

-- Recalcula un pedido con los precios vigentes. El navegador nunca es la autoridad del precio.
-- p_items: [{ "producto": id, "opcion": id o null, "cantidad": entero }]   p_entrega: 'retiro' | 'delivery'
-- No guarda nada: un pedido por WhatsApp no es una venta hasta que el negocio lo confirma y lo carga en la Caja.
create or replace function public.cotizar_pedido(p_slug text, p_items jsonb, p_entrega text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  neg uuid; m jsonb; cfg jsonb; it jsonb; d jsonb; pub jsonb; op jsonb;
  cant int; unit numeric; renglones jsonb := '[]'; errores jsonb := '[]'; subtotal numeric := 0; envio numeric;
begin
  select x.negocio_id, x.menu into neg, m from public.menu_negocio(p_slug) x;
  if neg is null then raise exception 'El menú no está disponible.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'El pedido está vacío.'; end if;
  if jsonb_array_length(p_items) > 60 then raise exception 'El pedido tiene demasiados renglones.'; end if;
  if p_entrega not in ('retiro', 'delivery') then raise exception 'Elegí delivery o retiro.'; end if;
  cfg := public.menu_config(m);

  for it in select * from jsonb_array_elements(p_items) loop
    if coalesce(it->>'cantidad', '') !~ '^\d{1,3}$' or (it->>'cantidad')::int not between 1 and 99 then
      errores := errores || jsonb_build_object('producto', it->>'producto', 'error', 'cantidad');
      continue;
    end if;
    cant := (it->>'cantidad')::int;
    select p.datos into d from public.productos p where p.negocio_id = neg and p.id = it->>'producto';
    if d is null or not public.menu_vendible(d) then
      errores := errores || jsonb_build_object('producto', it->>'producto', 'error', 'no_existe');
      continue;
    end if;
    pub := public.menu_producto(it->>'producto', d);
    if not (pub->>'disponible')::boolean then
      errores := errores || jsonb_build_object('producto', it->>'producto', 'error', 'agotado', 'nombre', pub->>'nombre');
      continue;
    end if;
    op := null;
    if coalesce(it->>'opcion', '') <> '' then
      select x.o into op from jsonb_array_elements(pub->'opciones') x(o) where x.o->>'id' = it->>'opcion';
      if op is null then
        errores := errores || jsonb_build_object('producto', it->>'producto', 'error', 'opcion', 'nombre', pub->>'nombre');
        continue;
      end if;
    end if;
    unit := (pub->>'precio')::numeric + coalesce((op->>'precio_extra')::numeric, 0);
    subtotal := subtotal + unit * cant;
    renglones := renglones || jsonb_build_object(
      'producto', pub->>'id', 'nombre', pub->>'nombre', 'plural', pub->'plural', 'tipo', pub->>'tipo',
      'opcion', op->>'id', 'opcion_nombre', op->>'nombre',
      'cantidad', cant, 'precio_unitario', unit, 'subtotal', unit * cant);
  end loop;

  envio := case when p_entrega = 'delivery' then (cfg->>'envio')::numeric end;
  return jsonb_build_object(
    'renglones', renglones, 'errores', errores,
    'subtotal', subtotal,
    'envio', envio,                                  -- null = delivery sin precio cargado: se confirma por WhatsApp
    'envio_a_confirmar', p_entrega = 'delivery' and envio is null,
    'total', subtotal + coalesce(envio, 0),
    'version', (public.menu_publico(p_slug))->>'version',
    'calculado_en', now());
end $$;

-- Solo estas dos funciones se pueden llamar sin login. Las demás quedan cerradas.
revoke all on function public.menu_producto(text, jsonb) from public, anon, authenticated;
revoke all on function public.menu_vendible(jsonb) from public, anon, authenticated;
revoke all on function public.menu_config(jsonb) from public, anon, authenticated;
revoke all on function public.menu_publico(text) from public;
revoke all on function public.cotizar_pedido(text, jsonb, text) from public;
grant execute on function public.menu_publico(text) to anon, authenticated;
grant execute on function public.cotizar_pedido(text, jsonb, text) to anon, authenticated;

-- ---------- Fotos del menú ----------
-- Se guardan en Supabase Storage (bucket público "menu-fotos"), en una carpeta por negocio.
-- Cualquiera puede verlas (son las fotos del menú); solo el dueño puede subir o borrar las de su negocio.
-- En una base sin Storage (pruebas locales) esta parte se saltea sola.
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Sin Storage: se saltea la parte de fotos.';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('menu-fotos', 'menu-fotos', true, 1048576, array['image/jpeg', 'image/webp', 'image/png'])
  on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg', 'image/webp', 'image/png'];

  execute 'drop policy if exists "menu-fotos: dueño sube" on storage.objects';
  execute 'drop policy if exists "menu-fotos: dueño cambia" on storage.objects';
  execute 'drop policy if exists "menu-fotos: dueño borra" on storage.objects';
  execute $p$create policy "menu-fotos: dueño sube" on storage.objects for insert to authenticated
    with check (bucket_id = 'menu-fotos' and public.puede_usar(((storage.foldername(name))[1])::uuid))$p$;
  execute $p$create policy "menu-fotos: dueño cambia" on storage.objects for update to authenticated
    using (bucket_id = 'menu-fotos' and public.puede_usar(((storage.foldername(name))[1])::uuid))$p$;
  execute $p$create policy "menu-fotos: dueño borra" on storage.objects for delete to authenticated
    using (bucket_id = 'menu-fotos' and public.puede_usar(((storage.foldername(name))[1])::uuid))$p$;
end $$;
