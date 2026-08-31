-- ============================================================
--  PADDOCK CAR CENTER — Esquema de base de datos (Supabase / PostgreSQL)
--  Modelo completo. Se construye por capas, pero se diseña entero
--  desde el día 1 para no rehacer tablas.
--
--  Eje del sistema: el VEHÍCULO (patente). Todo cuelga de ahí,
--  pero es OPCIONAL en las operaciones (hay ventas de mostrador
--  sin auto de por medio).
-- ============================================================


-- ------------------------------------------------------------
--  1. USUARIOS Y CONFIG  (Capa 1 — base)
-- ------------------------------------------------------------

-- Auth propia con SHA-256, mismo patrón que usaste en BarberSys.
-- No usamos Supabase Auth: los usuarios se validan contra esta tabla.
create table usuarios_app (
  id          uuid primary key default gen_random_uuid(),
  usuario     text not null unique,
  pass_hash   text not null,                 -- SHA-256 de la contraseña
  nombre      text,
  rol         text not null default 'empleado',  -- 'admin' | 'empleado'
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

-- Configuración general del negocio (clave/valor), igual que BarberSys.
create table config (
  clave   text primary key,
  valor   jsonb not null,
  notas   text
);


-- ------------------------------------------------------------
--  2. CLIENTES Y VEHÍCULOS  (Capa 1 — el eje)
-- ------------------------------------------------------------

create table clientes (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  telefono    text,
  email       text,
  notas       text,
  creado_en   timestamptz not null default now()
);

create table vehiculos (
  id          uuid primary key default gen_random_uuid(),
  patente     text not null unique,          -- identificador natural del auto
  marca       text,
  modelo      text,
  anio        int,
  km          int,                           -- último kilometraje conocido
  cliente_id  uuid references clientes(id) on delete set null,
  notas       text,
  creado_en   timestamptz not null default now()
);

create index idx_vehiculos_cliente on vehiculos(cliente_id);
create index idx_vehiculos_patente on vehiculos(patente);


-- ------------------------------------------------------------
--  3. PROVEEDORES Y PRODUCTOS  (Capa 2 — repuestos/stock)
-- ------------------------------------------------------------

create table proveedores (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  telefono    text,
  notas       text,
  creado_en   timestamptz not null default now()
);

create table productos (
  id             uuid primary key default gen_random_uuid(),
  codigo         text unique,                -- código interno o de barras
  nombre         text not null,
  categoria      text,                       -- 'repuesto' | 'lubricante' | 'insumo' | ...
  precio_compra  numeric(12,2) default 0,
  precio_venta   numeric(12,2) default 0,
  stock          numeric(12,2) not null default 0,   -- stock actual
  stock_minimo   numeric(12,2) default 0,            -- para alertas
  proveedor_id   uuid references proveedores(id) on delete set null,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now()
);

create index idx_productos_codigo on productos(codigo);


-- ------------------------------------------------------------
--  4. OPERACIONES  (Capa 2/3 — el corazón)
--
--  Una operación = toda transacción del negocio, sea del rubro
--  que sea. El campo 'tipo' la distingue. La caja y los reportes
--  van todos a buscar acá: un solo caño.
-- ------------------------------------------------------------

create table operaciones (
  id           uuid primary key default gen_random_uuid(),
  tipo         text not null,                -- 'taller' | 'lubricentro' | 'venta'
  estado       text not null default 'abierta', -- 'abierta' | 'cerrada' | 'anulada'
  vehiculo_id  uuid references vehiculos(id) on delete set null,  -- OPCIONAL (mostrador)
  cliente_id   uuid references clientes(id) on delete set null,   -- OPCIONAL
  usuario_id   uuid references usuarios_app(id) on delete set null, -- quién la hizo
  descripcion  text,                         -- ej. "Cambio de aceite + filtro"
  km_ingreso   int,                          -- km del auto al ingresar (taller/lube)
  total        numeric(12,2) not null default 0,   -- se recalcula desde los items
  creado_en    timestamptz not null default now(),
  cerrado_en   timestamptz
);

create index idx_operaciones_tipo on operaciones(tipo);
create index idx_operaciones_vehiculo on operaciones(vehiculo_id);
create index idx_operaciones_fecha on operaciones(creado_en);

-- Detalle de cada operación: repuestos usados + mano de obra.
create table operacion_items (
  id            uuid primary key default gen_random_uuid(),
  operacion_id  uuid not null references operaciones(id) on delete cascade,
  tipo_item     text not null default 'producto',  -- 'producto' | 'mano_obra'
  producto_id   uuid references productos(id) on delete set null,  -- null si es mano de obra
  descripcion   text not null,                -- nombre del producto o del trabajo
  cantidad      numeric(12,2) not null default 1,
  precio_unit   numeric(12,2) not null default 0,
  subtotal      numeric(12,2) not null default 0,   -- cantidad * precio_unit
  creado_en     timestamptz not null default now()
);

create index idx_items_operacion on operacion_items(operacion_id);


-- ------------------------------------------------------------
--  5. STOCK — MOVIMIENTOS  (Capa 2 — trazabilidad)
--
--  Cada entrada o salida de stock deja registro acá. El campo
--  productos.stock se actualiza desde la app al insertar el
--  movimiento (lógica en JS, como venís haciendo, sin triggers
--  mágicos escondidos).
-- ------------------------------------------------------------

create table movimientos_stock (
  id            uuid primary key default gen_random_uuid(),
  producto_id   uuid not null references productos(id) on delete cascade,
  tipo          text not null,               -- 'entrada' | 'salida' | 'ajuste'
  cantidad      numeric(12,2) not null,       -- siempre positivo; el tipo define el signo
  operacion_id  uuid references operaciones(id) on delete set null, -- si vino de una venta/orden
  motivo        text,                        -- 'compra', 'venta', 'rotura', 'conteo', ...
  usuario_id    uuid references usuarios_app(id) on delete set null,
  creado_en     timestamptz not null default now()
);

create index idx_movstock_producto on movimientos_stock(producto_id);
create index idx_movstock_fecha on movimientos_stock(creado_en);


-- ------------------------------------------------------------
--  6. CAJA — MOVIMIENTOS  (Capa 4 — la plata unificada)
--
--  Toda operación deja acá su registro de plata. La caja
--  unificada de las tres patas sale de esta sola tabla.
--  También admite movimientos manuales (retiros, gastos).
-- ------------------------------------------------------------

create table movimientos_caja (
  id            uuid primary key default gen_random_uuid(),
  tipo          text not null,               -- 'ingreso' | 'egreso'
  monto         numeric(12,2) not null,
  medio_pago    text,                        -- 'efectivo' | 'transferencia' | 'tarjeta' | ...
  concepto      text not null,               -- 'venta mostrador', 'orden taller', 'gasto', ...
  operacion_id  uuid references operaciones(id) on delete set null,
  usuario_id    uuid references usuarios_app(id) on delete set null,
  creado_en     timestamptz not null default now()
);

create index idx_movcaja_fecha on movimientos_caja(creado_en);
create index idx_movcaja_tipo on movimientos_caja(tipo);


-- ============================================================
--  RLS (seguridad a nivel de fila)
--
--  OJO: como la auth es propia (no Supabase Auth), la anon key
--  viaja en el cliente y es pública. Para un sistema interno esto
--  suele resolverse con RLS permisiva + no exponer la URL, pero
--  lo ideal a futuro es mover la escritura sensible detrás de
--  Edge Functions. Por ahora dejo RLS activada con política
--  permisiva para arrancar; lo endurecemos cuando cerremos capas.
-- ============================================================

alter table usuarios_app      enable row level security;
alter table config            enable row level security;
alter table clientes          enable row level security;
alter table vehiculos         enable row level security;
alter table proveedores       enable row level security;
alter table productos         enable row level security;
alter table operaciones       enable row level security;
alter table operacion_items   enable row level security;
alter table movimientos_stock enable row level security;
alter table movimientos_caja  enable row level security;

-- Política permisiva temporal (endurecer antes de producción real).
-- Repetir el bloque por tabla o generarlas con un script.
create policy "acceso_app" on clientes          for all using (true) with check (true);
create policy "acceso_app" on vehiculos         for all using (true) with check (true);
create policy "acceso_app" on proveedores       for all using (true) with check (true);
create policy "acceso_app" on productos         for all using (true) with check (true);
create policy "acceso_app" on operaciones       for all using (true) with check (true);
create policy "acceso_app" on operacion_items   for all using (true) with check (true);
create policy "acceso_app" on movimientos_stock for all using (true) with check (true);
create policy "acceso_app" on movimientos_caja  for all using (true) with check (true);
create policy "acceso_app" on config            for all using (true) with check (true);
-- usuarios_app: NO le pongas política permisiva de lectura abierta si vas
-- a guardar hashes. Leé sólo lo mínimo para el login desde una función.
