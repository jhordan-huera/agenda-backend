-- Las descripciones de los formatos de la plataforma empiezan por la consulta en la que se usan. Una
-- psicóloga duplicó «Psicología · Sesión» queriendo adaptar la historia inicial (2026-10-28): el nombre
-- solo no bastaba para saber cuál es cuál. Sólo cambia el texto; los campos y las versiones no se tocan.
update clinical_templates set description = v.description, updated_at = now()
  from (values
    ('evolucion-general', 'Para cualquier consulta, si ningún otro encaja: motivo, hallazgos, diagnóstico, tratamiento e indicaciones.'),
    ('atencion-medica', 'Para cada consulta médica: anamnesis, signos vitales, examen físico, diagnósticos CIE-10, exámenes, receta y descargo de responsabilidad.'),
    ('psicologia-evaluacion', 'Para la primera consulta: motivo, historia, examen mental, riesgo, impresión diagnóstica y plan.'),
    ('psicologia-sesion', 'Para las sesiones de seguimiento, después de la primera: nota DAP (datos, análisis y plan), estado de ánimo y riesgo.'),
    ('psicologia-escalas', 'Para aplicar las escalas de depresión y ansiedad cada cierto tiempo: puntaje automático para seguirlas en el tiempo.'),
    ('odontologia-consulta', 'Para cada consulta: examen extra e intraoral, procedimientos por pieza, diagnósticos, plan y receta.'),
    ('nutricion-control', 'Para cada control: antropometría con IMC automático, hábitos, diagnóstico y plan alimentario.'),
    ('fisioterapia-sesion', 'Para cada sesión: dolor al inicio y al final, evaluación, técnicas y ejercicios aplicados.'),
    ('fonoaudiologia-sesion', 'Para cada sesión: áreas trabajadas, objetivos, actividades y desempeño.'),
    ('estetica-procedimiento', 'Para cada procedimiento: zona, productos con lote y dosis, consentimiento e indicaciones.'),
    ('nota-libre', 'Para escribir sin formulario: un solo campo de texto.')
  ) as v(id, description)
 where clinical_templates.id = v.id and clinical_templates.business_id is null;
