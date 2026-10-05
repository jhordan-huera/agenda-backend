-- =============================================================================
-- Plantillas de la plataforma, versión 2: odontograma, mapa del cuerpo y escalas
-- =============================================================================
-- Versión nueva de cuatro plantillas (las evoluciones ya escritas conservan la 1) y una plantilla
-- nueva de escalas de psicología. PHQ-9 y GAD-7 (Pfizer) son de uso libre, sin permiso previo.

-- Inserta `new_field` después del campo `after_id` (o al final si no existe).
create function agendo_insert_field_after(fields jsonb, after_id text, new_field jsonb) returns jsonb
language sql immutable as $$
  select jsonb_agg(elem order by pos nulls last)
    from (
      select elem, ord::numeric as pos from jsonb_array_elements(fields) with ordinality as e(elem, ord)
      union all
      select new_field,
             (select ord from jsonb_array_elements(fields) with ordinality as e(elem, ord) where elem ->> 'id' = after_id) + 0.5
    ) as merged
$$;

create temporary table agendo_scales (id text primary key, field jsonb not null) on commit drop;
insert into agendo_scales values
  ('phq9', $json${
    "id": "phq9", "type": "questionnaire", "label": "PHQ-9 (depresión)",
    "prompt": "Durante las últimas 2 semanas, ¿con qué frecuencia le han molestado los siguientes problemas?",
    "items": [
      "Poco interés o placer en hacer las cosas",
      "Se ha sentido decaído(a), deprimido(a) o sin esperanzas",
      "Dificultad para dormir o permanecer dormido(a), o ha dormido demasiado",
      "Se ha sentido cansado(a) o con poca energía",
      "Poco apetito o ha comido en exceso",
      "Se ha sentido mal consigo mismo(a), que es un fracaso o que ha quedado mal con usted mismo(a) o con su familia",
      "Dificultad para concentrarse en actividades como leer o ver la televisión",
      "Se ha movido o hablado tan despacio que otros lo han notado, o lo contrario: muy inquieto(a)",
      "Pensamientos de que estaría mejor muerto(a) o de hacerse daño de alguna manera"
    ],
    "options": [
      {"label": "Ningún día", "points": 0},
      {"label": "Varios días", "points": 1},
      {"label": "Más de la mitad de los días", "points": 2},
      {"label": "Casi todos los días", "points": 3}
    ],
    "ranges": [
      {"min": 0, "max": 4, "label": "Mínima"},
      {"min": 5, "max": 9, "label": "Leve"},
      {"min": 10, "max": 14, "label": "Moderada"},
      {"min": 15, "max": 19, "label": "Moderadamente grave"},
      {"min": 20, "max": 27, "label": "Grave"}
    ],
    "alerts": [
      {"item": 8, "minPoints": 1, "message": "Respuesta positiva en la pregunta 9 (ideas de muerte o autolesión): evaluar el riesgo."}
    ]
  }$json$::jsonb),
  ('gad7', $json${
    "id": "gad7", "type": "questionnaire", "label": "GAD-7 (ansiedad)",
    "prompt": "Durante las últimas 2 semanas, ¿con qué frecuencia le han molestado los siguientes problemas?",
    "items": [
      "Se ha sentido nervioso(a), ansioso(a) o con los nervios de punta",
      "No ha podido dejar de preocuparse o controlar la preocupación",
      "Se ha preocupado demasiado por motivos diferentes",
      "Ha tenido dificultad para relajarse",
      "Se ha sentido tan inquieto(a) que no podía quedarse quieto(a)",
      "Se ha molestado o irritado fácilmente",
      "Ha tenido miedo de que algo terrible fuera a pasar"
    ],
    "options": [
      {"label": "Ningún día", "points": 0},
      {"label": "Varios días", "points": 1},
      {"label": "Más de la mitad de los días", "points": 2},
      {"label": "Casi todos los días", "points": 3}
    ],
    "ranges": [
      {"min": 0, "max": 4, "label": "Mínima"},
      {"min": 5, "max": 9, "label": "Leve"},
      {"min": 10, "max": 14, "label": "Moderada"},
      {"min": 15, "max": 21, "label": "Grave"}
    ]
  }$json$::jsonb);

-- Nuevas versiones a partir de la vigente de cada plantilla.
insert into clinical_template_versions (template_id, version, name, fields)
select t.id, v.version + 1, t.name,
       case t.id
         when 'atencion-medica' then agendo_insert_field_after(v.fields, 'injuries',
           '{"id": "injury_map", "type": "bodymap", "label": "Localización de lesiones"}')
         when 'odontologia-consulta' then agendo_insert_field_after(v.fields, 'intraoral',
           '{"id": "odontogram", "type": "odontogram", "label": "Odontograma", "hint": "Se copia el último registrado: actualiza lo que cambió."}')
         when 'fisioterapia-sesion' then agendo_insert_field_after(v.fields, 'pain_after',
           '{"id": "pain_map", "type": "bodymap", "label": "Zonas de dolor"}')
         when 'psicologia-evaluacion' then agendo_insert_field_after(
           agendo_insert_field_after(v.fields, 'tests_applied', (select field from agendo_scales where id = 'phq9')),
           'phq9', (select field from agendo_scales where id = 'gad7'))
       end
  from clinical_templates t
  join clinical_template_versions v on v.id = t.current_version_id
 where t.id in ('atencion-medica', 'odontologia-consulta', 'fisioterapia-sesion', 'psicologia-evaluacion');

update clinical_templates t
   set current_version_id = v.id, updated_at = now()
  from clinical_template_versions v
 where v.template_id = t.id
   and t.id in ('atencion-medica', 'odontologia-consulta', 'fisioterapia-sesion', 'psicologia-evaluacion')
   and v.version = (select max(version) from clinical_template_versions where template_id = t.id);

-- Plantilla nueva: escalas para seguir la evolución sesión a sesión (con gráfico en la ficha).
insert into clinical_templates (id, name, description, categories, sort_order, current_version_id)
values ('psicologia-escalas', 'Psicología · Escalas PHQ-9 y GAD-7',
        'Cuestionarios de depresión y ansiedad con puntaje automático, para seguirlos en el tiempo.',
        '{psychology}', 32, '00000000-0000-4000-8000-0000000000b1');
insert into clinical_template_versions (id, template_id, version, name, fields)
values ('00000000-0000-4000-8000-0000000000b1', 'psicologia-escalas', 1, 'Psicología · Escalas PHQ-9 y GAD-7',
        jsonb_build_array(
          (select field from agendo_scales where id = 'phq9'),
          (select field from agendo_scales where id = 'gad7'),
          '{"id": "observations", "type": "textarea", "label": "Observaciones"}'::jsonb
        ));

drop function agendo_insert_field_after(jsonb, text, jsonb);
