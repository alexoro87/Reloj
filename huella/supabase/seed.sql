-- Clínica de ejemplo para un proyecto Supabase recién creado.
-- Usuario: recepcion@piesano.demo / demo1234 → CAMBIA la contraseña antes de producción
-- (genera un hash nuevo con: node scripts/hash-password.mjs "tu-contraseña").

insert into clinics (id, slug, name, timezone, country_code, phone, address, reception_email)
values ('c0000000-0000-4000-8000-000000000001', 'pie-sano', 'Clínica Podológica Pie Sano',
        'America/Mexico_City', '52', '55 1234 5678',
        'Av. Insurgentes Sur 1234, Col. Del Valle, CDMX', 'recepcion@piesano.demo');

insert into practitioners (id, clinic_id, name, title, bio, color) values
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Dra. Laura Méndez', 'Podóloga clínica', 'Pie diabético y uñas encarnadas.', '#2f6f62'),
  ('a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'Dr. Andrés Ruiz', 'Podólogo deportivo', 'Estudio de la pisada y plantillas.', '#c2643f'),
  ('a0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'Lic. Sofía Torres', 'Podóloga', 'Quiropodia y tratamiento de hongos.', '#5b5fc7');

insert into services (id, clinic_id, name, description, duration_min, price_cents, follow_up_weeks) values
  ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Quiropodia', 'Corte y limpieza de uñas, durezas y callosidades.', 30, 45000, 6),
  ('b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'Uña encarnada', 'Tratamiento conservador o espiculotomía.', 45, 70000, 2),
  ('b0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'Estudio de la pisada', 'Análisis biomecánico para plantillas a medida.', 60, 90000, null),
  ('b0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'Revisión de pie diabético', 'Exploración vascular, neurológica y curación.', 45, 60000, 4),
  ('b0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001', 'Tratamiento de hongos', 'Onicomicosis: limpieza y aplicación tópica.', 30, 50000, 4),
  ('b0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000001', 'Entrega de plantillas', 'Prueba y ajuste de plantillas ortopédicas.', 20, 0, null);

insert into practitioner_services (practitioner_id, service_id) values
  ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000004'),
  ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000005'),
  ('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003'),
  ('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000006'),
  ('a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000005');

-- Lunes a viernes
insert into working_hours (practitioner_id, weekday, start_time, end_time)
select 'a0000000-0000-4000-8000-000000000001', d, '09:00', '14:00' from generate_series(1, 5) d
union all select 'a0000000-0000-4000-8000-000000000001', d, '16:00', '19:00' from generate_series(1, 5) d
union all select 'a0000000-0000-4000-8000-000000000002', d, '11:00', '19:00' from generate_series(1, 5) d
union all select 'a0000000-0000-4000-8000-000000000003', d, '08:00', '15:00' from generate_series(1, 5) d where d <> 3
union all select 'a0000000-0000-4000-8000-000000000001', 6, '09:00', '13:00'
union all select 'a0000000-0000-4000-8000-000000000003', 6, '09:00', '13:00';

insert into staff_users (clinic_id, email, name, password_hash, role) values
  ('c0000000-0000-4000-8000-000000000001', 'recepcion@piesano.demo', 'Recepción Pie Sano',
   'scrypt$937734dd32c7a69cad7263b1f6f8676b$89f0a98d77260833becd2e28979bbea125da831cc27a22592f07fcff790872ffc3e544624920fa686f7c4c732da5037b6787cdec5e9d0793552445f1cee437b2',
   'owner');
