-- =============================================================================
-- Plantillas de historia clínica
-- =============================================================================
-- Cada especialidad registra cosas distintas en una evolución (signos vitales, procedimientos
-- por pieza dental, antropometría, sesiones DAP…). Una plantilla define los campos; las
-- evoluciones guardan sus valores en `data` (jsonb) y la versión de plantilla con que se
-- escribieron. Las versiones no se modifican: si una plantilla cambia, se crea otra versión y
-- las evoluciones antiguas se siguen mostrando con sus campos originales.
--
-- Plantillas de la plataforma: business_id null (las ve todo negocio con historia clínica).
-- Plantillas propias de un negocio (planes de pago): business_id del negocio.

create table clinical_templates (
  id                 text primary key,
  business_id        uuid references businesses (id) on delete cascade,
  name               text not null,
  description        text not null default '',
  -- Especialidades (ids de business_categories) para las que se recomienda; vacío = general.
  categories         text[] not null default '{}',
  sort_order         int not null default 0,
  is_active          boolean not null default true,
  current_version_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table clinical_template_versions (
  id              uuid primary key default gen_random_uuid(),
  template_id     text not null references clinical_templates (id) on delete cascade,
  version         int not null,
  name            text not null,
  fields          jsonb not null check (jsonb_typeof(fields) = 'array'),
  created_by_name text not null default 'Plataforma',
  created_at      timestamptz not null default now(),
  unique (template_id, version)
);

-- Diferida: una plantilla y su primera versión se crean en la misma transacción.
alter table clinical_templates
  add constraint clinical_templates_current_version_fkey
  foreign key (current_version_id) references clinical_template_versions (id) deferrable initially deferred;

create index clinical_templates_business_idx on clinical_templates (business_id);

create function protect_clinical_template_version() returns trigger
language plpgsql as $$
begin
  raise exception 'Una versión de plantilla no se modifica: crea una versión nueva.' using errcode = '42501';
end;
$$;
create trigger clinical_template_versions_protect before update on clinical_template_versions
  for each row execute function protect_clinical_template_version();

alter table clinical_templates enable row level security;
alter table clinical_template_versions enable row level security;

-- ------------------------------------------------------ Plantillas de la plataforma --

insert into clinical_templates (id, name, description, categories, sort_order) values
  ('evolucion-general', 'Evolución general',
   'Motivo, hallazgos, diagnóstico, tratamiento e indicaciones.', '{}', 10),
  ('atencion-medica', 'Atención médica',
   'Anamnesis, signos vitales, examen físico, diagnósticos CIE-10, exámenes, receta y descargo de responsabilidad.', '{}', 20),
  ('psicologia-evaluacion', 'Psicología · Evaluación inicial',
   'Motivo, historia, examen mental, riesgo, impresión diagnóstica y plan.', '{psychology}', 30),
  ('psicologia-sesion', 'Psicología · Sesión',
   'Nota de sesión en formato DAP (datos, análisis y plan), estado de ánimo y riesgo.', '{psychology}', 31),
  ('odontologia-consulta', 'Odontología · Consulta',
   'Examen extra e intraoral, procedimientos por pieza, diagnósticos, plan y receta.', '{dentistry}', 40),
  ('nutricion-control', 'Nutrición · Control',
   'Antropometría con IMC automático, hábitos, diagnóstico y plan alimentario.', '{nutrition}', 50),
  ('fisioterapia-sesion', 'Fisioterapia · Sesión',
   'Dolor al inicio y al final, evaluación, técnicas y ejercicios aplicados.', '{physiotherapy}', 60),
  ('fonoaudiologia-sesion', 'Fonoaudiología · Sesión',
   'Áreas trabajadas, objetivos, actividades y desempeño.', '{speech_therapy}', 70),
  ('estetica-procedimiento', 'Medicina estética · Procedimiento',
   'Procedimiento, zona, productos con lote y dosis, consentimiento e indicaciones.', '{medicina_personalizada_estetica}', 80),
  ('nota-libre', 'Nota libre',
   'Un solo campo de texto, para quien prefiere escribir sin formulario.', '{}', 90);

insert into clinical_template_versions (template_id, version, name, fields)
select t.id, 1, t.name, v.fields::jsonb
  from (values
    -- Mismos campos que las evoluciones anteriores a las plantillas (se migran abajo).
    ('evolucion-general', $json$[
      {"id": "reason", "type": "textarea", "label": "Motivo de consulta", "required": true},
      {"id": "findings", "type": "textarea", "label": "Hallazgos / evaluación"},
      {"id": "diagnosis", "type": "textarea", "label": "Diagnóstico"},
      {"id": "treatment", "type": "textarea", "label": "Tratamiento / plan"},
      {"id": "indications", "type": "textarea", "label": "Indicaciones"},
      {"id": "next_control", "type": "text", "label": "Próximo control", "placeholder": "Ej.: en 15 días"}
    ]$json$),
    ('atencion-medica', $json$[
      {"id": "anamnesis", "type": "section", "label": "Anamnesis"},
      {"id": "reason", "type": "text", "label": "Motivo de consulta", "required": true},
      {"id": "current_illness", "type": "textarea", "label": "Enfermedad actual",
       "hint": "Inicio, evolución, síntomas y medicación tomada antes de la consulta."},
      {"id": "vitals", "type": "section", "label": "Signos vitales"},
      {"id": "blood_pressure", "type": "text", "label": "Presión arterial (mmHg)", "placeholder": "120/80"},
      {"id": "heart_rate", "type": "number", "label": "Frecuencia cardiaca", "unit": "lpm", "min": 20, "max": 250},
      {"id": "respiratory_rate", "type": "number", "label": "Frecuencia respiratoria", "unit": "rpm", "min": 4, "max": 80},
      {"id": "temperature", "type": "number", "label": "Temperatura", "unit": "°C", "min": 30, "max": 45, "step": 0.1},
      {"id": "oxygen_saturation", "type": "number", "label": "Saturación de oxígeno", "unit": "%", "min": 50, "max": 100},
      {"id": "glucose", "type": "number", "label": "Glucemia capilar", "unit": "mg/dL", "min": 10, "max": 1000},
      {"id": "weight", "type": "number", "label": "Peso", "unit": "kg", "min": 0.5, "max": 400, "step": 0.1},
      {"id": "pain", "type": "scale", "label": "Dolor (EVA)", "min": 0, "max": 10, "minLabel": "Sin dolor", "maxLabel": "Máximo"},
      {"id": "exam", "type": "section", "label": "Examen físico"},
      {"id": "exam_regions", "type": "multiselect", "label": "Regiones examinadas",
       "options": ["Cabeza", "Cuello", "Tórax", "Corazón", "Pulmones", "Abdomen", "Extremidades", "Piel", "Neurológico"]},
      {"id": "exam_findings", "type": "textarea", "label": "Hallazgos del examen físico"},
      {"id": "injuries", "type": "textarea", "label": "Lesiones / trauma", "hint": "Localización y descripción."},
      {"id": "plan_section", "type": "section", "label": "Diagnóstico y plan"},
      {"id": "diagnoses", "type": "list", "label": "Diagnósticos", "addLabel": "Agregar diagnóstico", "columns": [
        {"id": "description", "label": "Diagnóstico", "type": "text"},
        {"id": "cie10", "label": "CIE-10", "type": "text", "placeholder": "K02.9"}
      ]},
      {"id": "exams_requested", "type": "multiselect", "label": "Solicitud de exámenes",
       "options": ["Laboratorio", "Imagen", "Interconsulta", "Otro"]},
      {"id": "exams_detail", "type": "textarea", "label": "Detalle de exámenes o interconsulta"},
      {"id": "prescription", "type": "list", "label": "Receta", "addLabel": "Agregar medicamento", "columns": [
        {"id": "quantity", "label": "Cantidad", "type": "number"},
        {"id": "active_ingredient", "label": "Principio activo", "type": "text"},
        {"id": "brand", "label": "Nombre comercial", "type": "text"},
        {"id": "instructions", "label": "Indicaciones", "type": "text", "placeholder": "Cada 8 horas por 5 días"}
      ]},
      {"id": "indications", "type": "textarea", "label": "Indicaciones generales"},
      {"id": "next_control", "type": "text", "label": "Próximo control"},
      {"id": "waiver", "type": "section", "label": "Descargo de responsabilidad"},
      {"id": "refuses_treatment", "type": "boolean", "label": "Rehúsa tratamiento"},
      {"id": "refuses_transfer", "type": "boolean", "label": "Rehúsa traslado"}
    ]$json$),
    ('psicologia-evaluacion', $json$[
      {"id": "reason", "type": "textarea", "label": "Motivo de consulta", "required": true},
      {"id": "problem_history", "type": "textarea", "label": "Historia del problema actual"},
      {"id": "personal_history", "type": "textarea", "label": "Historia personal y familiar",
       "hint": "Desarrollo, familia, estudios, trabajo y relaciones."},
      {"id": "mental_exam", "type": "textarea", "label": "Examen mental",
       "hint": "Apariencia, conducta, afecto, pensamiento, percepción y cognición."},
      {"id": "risk", "type": "select", "label": "Riesgo de suicidio o autolesión",
       "options": ["Sin riesgo aparente", "Bajo", "Moderado", "Alto"]},
      {"id": "tests_applied", "type": "textarea", "label": "Pruebas aplicadas y resultados"},
      {"id": "diagnoses", "type": "list", "label": "Impresión diagnóstica", "addLabel": "Agregar diagnóstico", "columns": [
        {"id": "description", "label": "Diagnóstico", "type": "text"},
        {"id": "code", "label": "CIE-10 / DSM-5", "type": "text"}
      ]},
      {"id": "goals", "type": "textarea", "label": "Objetivos terapéuticos"},
      {"id": "plan", "type": "textarea", "label": "Plan de intervención",
       "hint": "Enfoque, frecuencia y número estimado de sesiones."}
    ]$json$),
    ('psicologia-sesion', $json$[
      {"id": "topic", "type": "text", "label": "Tema de la sesión", "required": true},
      {"id": "mood", "type": "scale", "label": "Estado de ánimo", "min": 0, "max": 10, "minLabel": "Muy bajo", "maxLabel": "Muy bueno"},
      {"id": "dap_data", "type": "textarea", "label": "Datos", "hint": "Lo que el paciente refiere y lo que se observa."},
      {"id": "dap_assessment", "type": "textarea", "label": "Análisis", "hint": "Interpretación clínica y avances."},
      {"id": "dap_plan", "type": "textarea", "label": "Plan", "hint": "Próximos pasos."},
      {"id": "techniques", "type": "textarea", "label": "Técnicas utilizadas"},
      {"id": "risk", "type": "select", "label": "Riesgo de suicidio o autolesión",
       "options": ["Sin riesgo aparente", "Bajo", "Moderado", "Alto"]},
      {"id": "homework", "type": "textarea", "label": "Tareas para la casa"},
      {"id": "next_session", "type": "text", "label": "Próxima sesión"}
    ]$json$),
    ('odontologia-consulta', $json$[
      {"id": "reason", "type": "text", "label": "Motivo de consulta", "required": true},
      {"id": "pain", "type": "scale", "label": "Dolor (EVA)", "min": 0, "max": 10, "minLabel": "Sin dolor", "maxLabel": "Máximo"},
      {"id": "extraoral", "type": "textarea", "label": "Examen extraoral"},
      {"id": "intraoral", "type": "textarea", "label": "Examen intraoral", "hint": "Tejidos blandos, encías, oclusión e higiene."},
      {"id": "procedures", "type": "list", "label": "Procedimientos realizados", "addLabel": "Agregar procedimiento", "columns": [
        {"id": "tooth", "label": "Pieza", "type": "text", "placeholder": "36"},
        {"id": "surface", "label": "Cara", "type": "text", "placeholder": "O, M, D, V, L"},
        {"id": "procedure", "label": "Procedimiento", "type": "text"},
        {"id": "notes", "label": "Observación", "type": "text"}
      ]},
      {"id": "anesthesia", "type": "text", "label": "Anestesia", "placeholder": "Lidocaína 2 % · 1 cartucho"},
      {"id": "diagnoses", "type": "list", "label": "Diagnósticos", "addLabel": "Agregar diagnóstico", "columns": [
        {"id": "description", "label": "Diagnóstico", "type": "text"},
        {"id": "cie10", "label": "CIE-10", "type": "text", "placeholder": "K02.1"}
      ]},
      {"id": "treatment_plan", "type": "textarea", "label": "Plan de tratamiento", "hint": "Pendientes por pieza y en qué orden."},
      {"id": "prescription", "type": "list", "label": "Receta", "addLabel": "Agregar medicamento", "columns": [
        {"id": "quantity", "label": "Cantidad", "type": "number"},
        {"id": "active_ingredient", "label": "Principio activo", "type": "text"},
        {"id": "brand", "label": "Nombre comercial", "type": "text"},
        {"id": "instructions", "label": "Indicaciones", "type": "text"}
      ]},
      {"id": "indications", "type": "textarea", "label": "Indicaciones"},
      {"id": "next_control", "type": "text", "label": "Próximo control"}
    ]$json$),
    ('nutricion-control', $json$[
      {"id": "reason", "type": "text", "label": "Motivo de consulta u objetivo", "required": true},
      {"id": "anthropometry", "type": "section", "label": "Antropometría"},
      {"id": "weight", "type": "number", "label": "Peso", "unit": "kg", "min": 0.5, "max": 400, "step": 0.1},
      {"id": "height", "type": "number", "label": "Talla", "unit": "cm", "min": 30, "max": 250, "step": 0.1},
      {"id": "bmi", "type": "bmi", "label": "IMC", "weightField": "weight", "heightField": "height"},
      {"id": "body_fat", "type": "number", "label": "Grasa corporal", "unit": "%", "min": 1, "max": 80, "step": 0.1},
      {"id": "muscle_mass", "type": "number", "label": "Masa muscular", "unit": "kg", "min": 1, "max": 200, "step": 0.1},
      {"id": "waist", "type": "number", "label": "Cintura", "unit": "cm", "min": 20, "max": 300, "step": 0.1},
      {"id": "hip", "type": "number", "label": "Cadera", "unit": "cm", "min": 20, "max": 300, "step": 0.1},
      {"id": "habits", "type": "section", "label": "Hábitos"},
      {"id": "recall_24h", "type": "textarea", "label": "Recordatorio de 24 horas"},
      {"id": "physical_activity", "type": "select", "label": "Actividad física", "options": ["Sedentaria", "Ligera", "Moderada", "Intensa"]},
      {"id": "water", "type": "number", "label": "Agua al día", "unit": "vasos", "min": 0, "max": 30},
      {"id": "plan_section", "type": "section", "label": "Diagnóstico y plan"},
      {"id": "nutritional_diagnosis", "type": "textarea", "label": "Diagnóstico nutricional"},
      {"id": "meal_plan", "type": "textarea", "label": "Plan alimentario"},
      {"id": "supplements", "type": "textarea", "label": "Suplementos"},
      {"id": "indications", "type": "textarea", "label": "Indicaciones"},
      {"id": "next_control", "type": "text", "label": "Próximo control"}
    ]$json$),
    ('fisioterapia-sesion', $json$[
      {"id": "area", "type": "text", "label": "Zona o motivo", "required": true, "placeholder": "Hombro derecho"},
      {"id": "session_number", "type": "number", "label": "Sesión n.º", "min": 1, "max": 500},
      {"id": "pain_before", "type": "scale", "label": "Dolor al inicio (EVA)", "min": 0, "max": 10, "minLabel": "Sin dolor", "maxLabel": "Máximo"},
      {"id": "pain_after", "type": "scale", "label": "Dolor al final (EVA)", "min": 0, "max": 10, "minLabel": "Sin dolor", "maxLabel": "Máximo"},
      {"id": "assessment", "type": "textarea", "label": "Evaluación", "hint": "Rango de movimiento, fuerza y pruebas especiales."},
      {"id": "treatment", "type": "list", "label": "Tratamiento aplicado", "addLabel": "Agregar técnica o ejercicio", "columns": [
        {"id": "technique", "label": "Técnica o ejercicio", "type": "text"},
        {"id": "sets", "label": "Series", "type": "number"},
        {"id": "reps", "label": "Repeticiones o tiempo", "type": "text"},
        {"id": "notes", "label": "Observación", "type": "text"}
      ]},
      {"id": "response", "type": "textarea", "label": "Respuesta del paciente"},
      {"id": "home_exercises", "type": "textarea", "label": "Ejercicios para la casa"},
      {"id": "next_session", "type": "text", "label": "Próxima sesión"}
    ]$json$),
    ('fonoaudiologia-sesion', $json$[
      {"id": "areas", "type": "multiselect", "label": "Áreas trabajadas", "required": true,
       "options": ["Lenguaje", "Habla", "Voz", "Deglución", "Audición", "Lectoescritura", "Fluidez"]},
      {"id": "goals", "type": "textarea", "label": "Objetivos de la sesión"},
      {"id": "activities", "type": "textarea", "label": "Actividades realizadas"},
      {"id": "performance", "type": "select", "label": "Desempeño", "options": ["Logrado", "En proceso", "No logrado"]},
      {"id": "tests", "type": "textarea", "label": "Pruebas aplicadas y resultados"},
      {"id": "observations", "type": "textarea", "label": "Observaciones"},
      {"id": "home_tasks", "type": "textarea", "label": "Tareas para la casa"},
      {"id": "next_session", "type": "text", "label": "Próxima sesión"}
    ]$json$),
    ('estetica-procedimiento', $json$[
      {"id": "procedure", "type": "text", "label": "Procedimiento", "required": true},
      {"id": "zone", "type": "text", "label": "Zona tratada"},
      {"id": "products", "type": "list", "label": "Productos aplicados", "addLabel": "Agregar producto", "columns": [
        {"id": "product", "label": "Producto", "type": "text"},
        {"id": "batch", "label": "Lote", "type": "text"},
        {"id": "dose", "label": "Dosis o cantidad", "type": "text"}
      ]},
      {"id": "technique", "type": "textarea", "label": "Técnica"},
      {"id": "consent_signed", "type": "boolean", "label": "Consentimiento del procedimiento firmado"},
      {"id": "reaction", "type": "textarea", "label": "Reacción inmediata u observaciones"},
      {"id": "post_care", "type": "textarea", "label": "Indicaciones posteriores"},
      {"id": "next_control", "type": "text", "label": "Próximo control"}
    ]$json$),
    ('nota-libre', $json$[
      {"id": "note", "type": "textarea", "label": "Nota", "required": true}
    ]$json$)
  ) as v (template_id, fields)
  join clinical_templates t on t.id = v.template_id;

update clinical_templates t
   set current_version_id = v.id
  from clinical_template_versions v
 where v.template_id = t.id and v.version = 1;

-- Comprueba ya la referencia diferida: con eventos pendientes no se puede alterar la tabla.
set constraints clinical_templates_current_version_fkey immediate;
alter table clinical_templates alter column current_version_id set not null;

-- --------------------------------------- Evoluciones: contenido según la plantilla --

alter table clinical_notes
  add column template_version_id uuid references clinical_template_versions (id) on delete restrict,
  add column data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object');

-- Las evoluciones existentes pasan a "Evolución general" con los mismos datos (sólo los campos
-- con contenido). El trigger de inmutabilidad no salta: vigila otras columnas.
update clinical_notes
   set template_version_id = (
         select id from clinical_template_versions where template_id = 'evolucion-general' and version = 1
       ),
       data = jsonb_strip_nulls(jsonb_build_object(
         'reason', nullif(reason, ''),
         'findings', nullif(findings, ''),
         'diagnosis', nullif(diagnosis, ''),
         'treatment', nullif(treatment, ''),
         'indications', nullif(indications, ''),
         'next_control', nullif(next_control, '')
       ));

alter table clinical_notes alter column template_version_id set not null;

drop trigger clinical_notes_protect on clinical_notes;
alter table clinical_notes
  drop column reason,
  drop column findings,
  drop column diagnosis,
  drop column treatment,
  drop column indications,
  drop column next_control;
create trigger clinical_notes_protect before update of
  business_id, client_id, date, template_version_id, data, author_name, created_at
  on clinical_notes for each row execute function protect_clinical_note();
