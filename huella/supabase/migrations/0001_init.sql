-- Huella · esquema inicial multi-clínica
-- Todas las tablas cuelgan de clinic_id. El acceso se hace exclusivamente desde
-- el servidor con la service-role key; RLS está activado sin políticas para
-- anon/authenticated, de modo que la API pública de Supabase no expone nada.

create extension if not exists btree_gist;

create table clinics (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  name text not null,
  timezone text not null default 'America/Mexico_City',
  country_code text not null default '52',
  phone text,
  address text,
  reception_email text,
  reminder_hours_before int not null default 24 check (reminder_hours_before between 1 and 168),
  min_notice_minutes int not null default 60,
  booking_horizon_days int not null default 30,
  google_refresh_token text,          -- en producción: cifrar con Supabase Vault
  google_calendar_id text,
  whatsapp_phone_number_id text,
  created_at timestamptz not null default now()
);

create table practitioners (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  name text not null,
  title text,
  bio text,
  color text not null default '#2f6f62',
  google_calendar_id text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on practitioners (clinic_id);

create table services (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  name text not null,
  description text,
  duration_min int not null check (duration_min between 5 and 480),
  price_cents int,
  follow_up_weeks int check (follow_up_weeks between 1 and 52),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on services (clinic_id);

create table practitioner_services (
  practitioner_id uuid not null references practitioners(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade,
  primary key (practitioner_id, service_id)
);

create table working_hours (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references practitioners(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (end_time > start_time)
);
create index on working_hours (practitioner_id);

create table time_off (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references practitioners(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  check (ends_at > starts_at)
);
create index on time_off (practitioner_id, starts_at);

create table patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  name text not null,
  phone text not null check (phone ~ '^[0-9]{8,15}$'),
  email text,
  whatsapp_opt_in boolean not null default false,
  whatsapp_opt_in_at timestamptz,
  created_at timestamptz not null default now(),
  unique (clinic_id, phone)
);

create type appointment_status as enum ('booked', 'confirmed', 'cancelled', 'completed', 'no_show');
create type appointment_source as enum ('online', 'reception', 'follow_up');

create table appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  practitioner_id uuid not null references practitioners(id),
  service_id uuid not null references services(id),
  patient_id uuid not null references patients(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status appointment_status not null default 'booked',
  source appointment_source not null default 'online',
  manage_token text not null unique,
  google_event_id text,
  reminder_sent_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  -- Garantía dura contra dobles reservas: un podólogo no puede tener dos citas
  -- activas que se solapen, aunque dos pacientes reserven en el mismo milisegundo.
  constraint appointments_no_overlap exclude using gist (
    practitioner_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status in ('booked', 'confirmed'))
);
create index on appointments (clinic_id, starts_at);
create index on appointments (starts_at) where reminder_sent_at is null and status in ('booked', 'confirmed');

create type follow_up_status as enum ('pending', 'sent', 'booked', 'dismissed');

create table follow_ups (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  practitioner_id uuid not null references practitioners(id),
  service_id uuid not null references services(id),
  source_appointment_id uuid not null references appointments(id) on delete cascade,
  due_date date not null,
  status follow_up_status not null default 'pending',
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index on follow_ups (clinic_id, due_date);
create index on follow_ups (due_date) where status = 'pending';

create table message_log (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  patient_id uuid references patients(id) on delete set null,
  direction text not null check (direction in ('out', 'in')),
  kind text not null,
  body text not null,
  status text not null check (status in ('sent', 'simulated', 'failed', 'received')),
  buttons jsonb not null default '[]',
  error text,
  created_at timestamptz not null default now()
);
create index on message_log (clinic_id, created_at desc);

create table staff_users (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  email text not null unique check (email = lower(email)),
  name text not null,
  password_hash text not null,
  role text not null default 'reception' check (role in ('owner', 'reception', 'practitioner')),
  created_at timestamptz not null default now()
);

alter table clinics enable row level security;
alter table practitioners enable row level security;
alter table services enable row level security;
alter table practitioner_services enable row level security;
alter table working_hours enable row level security;
alter table time_off enable row level security;
alter table patients enable row level security;
alter table appointments enable row level security;
alter table follow_ups enable row level security;
alter table message_log enable row level security;
alter table staff_users enable row level security;
