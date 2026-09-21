# FoodLoop · Instrumento de evaluación con usuarios

Fase 4 de la metodología, parte cualitativa. Los indicadores que produce
`npm run evaluar` miden el comportamiento del artefacto; este
cuestionario mide la percepción de quienes lo usan. Los dos se reportan
juntos en la sección de resultados.

---

## Participantes

Entre 15 y 20 usuarios vinculados a la operación del catering
industrial. Distribución sugerida:

| Perfil | Participantes |
|---|---|
| Chefs y cocineros de línea | 7 a 8 |
| Responsables de producción | 4 a 5 |
| Personal administrativo | 3 a 4 |
| Control de calidad | 2 |

La segmentación por perfil importa: permite reportar si la comprensión
de las explicaciones varía entre quien decide en cocina y quien controla
desde escritorio, que es un hallazgo más interesante que un promedio
general.

---

## Consentimiento informado

Antes de comenzar, cada participante recibe por escrito:

- El propósito de la actividad y su carácter académico.
- Que la participación es voluntaria y puede interrumpirse en cualquier
  momento sin consecuencia.
- Que las respuestas son anónimas y solo se reportan agregadas.
- Que no se evalúa a la persona sino al sistema: no hay respuestas
  correctas ni incorrectas.

Este último punto conviene decirlo también en voz alta al empezar. Un
participante que cree que se le está evaluando tiende a decir que todo
se entiende perfectamente.

---

## Recorrido de la sesión

Duración estimada: 20 a 25 minutos.

1. **Entrada.** El participante inicia sesión con el perfil que
   corresponde a su puesto real.
2. **Panel.** Se le pide que describa en voz alta qué ve y qué cree que
   el sistema espera de él. No se le guía.
3. **Selección.** Se le pide que elija los lotes que combinaría para una
   misma preparación. Se observa si usa las casillas sin explicación
   previa.
4. **Recomendaciones.** Revisa las alternativas propuestas.
5. **Explicación.** Abre «¿Por qué?» y se le pregunta qué entiende de
   los factores. Al terminar, valora la claridad en la propia interfaz.
6. **Receta.** Revisa el detalle.
7. **Decisión.** Aprueba o descarta, según su criterio.
8. **Cuestionario.**

Durante el recorrido conviene anotar los puntos donde el participante
duda, retrocede o pregunta. Esos momentos suelen ser más informativos
que las respuestas del cuestionario.

---

## Cuestionario

Escala de Likert de cinco niveles:
**1** totalmente en desacuerdo · **2** en desacuerdo · **3** ni de
acuerdo ni en desacuerdo · **4** de acuerdo · **5** totalmente de
acuerdo.

### Facilidad de uso

1. Me resultó sencillo encontrar lo que necesitaba en la pantalla
   principal.
2. Supe qué hacer en cada paso sin necesidad de ayuda.
3. Seleccionar varios lotes para una misma preparación me resultó
   natural.

### Claridad de la interfaz

4. La información de cada lote (cantidad, vida útil, estado) se presenta
   de forma clara.
5. Distingo sin dificultad un lote apto de uno crítico o vencido.
6. Entiendo qué acciones puedo realizar y cuáles no me corresponden.

### Utilidad del modelo

7. Las preparaciones propuestas son viables en nuestra operación real.
8. El orden en que se presentan las alternativas me parece razonable.
9. El sistema me ayudaría a decidir más rápido que como lo hago hoy.
10. Que el sistema combine varios lotes en una misma receta refleja cómo
    trabajamos realmente.

### Comprensión de las recomendaciones

11. Entiendo por qué el sistema propone cada preparación.
12. La información de cada propuesta (porciones, cantidad aprovechada,
    lotes que consume) es suficiente para decidir.

### Comprensión de las explicaciones (XAI)

13. Los factores que muestra la explicación me resultan comprensibles.
14. Entiendo por qué unos factores pesan más que otros.
15. Las situaciones alternativas («si el lote tuviera menos horas…») me
    ayudan a entender el alcance de la recomendación.
16. Saber por qué se descartaron otras alternativas me resulta útil.

### Confianza

17. Confío en que las recomendaciones respetan los criterios sanitarios.
18. Aprobaría una recomendación del sistema sin verificarla por mi
    cuenta.
19. Si el sistema no propone nada, confío en que hay una razón válida.

### Satisfacción general

20. Usaría este sistema en mi trabajo diario.
21. Recomendaría su implementación en el centro de producción.

---

## Preguntas abiertas

Se registran textualmente, sin interpretar durante la sesión.

- ¿Qué fue lo más confuso de todo el recorrido?
- ¿Qué información le hizo falta para decidir con seguridad?
- ¿Hay alguna situación de su trabajo que el sistema no contempla?
- Si pudiera cambiar una sola cosa, ¿cuál sería?

---

## Análisis previsto

**Por dimensión.** Media y desviación de cada bloque. Una desviación
alta en un bloque indica desacuerdo entre participantes, que suele ser
más revelador que una media baja.

**Por perfil.** Comparación entre chefs, producción, administración y
calidad. Interesa especialmente el bloque de explicabilidad.

**Contraste con los datos del sistema.** Los ítems 13 a 16 se contrastan
con las valoraciones que el propio sistema registró en
`feedback_explicacion` durante la sesión. Si el cuestionario dice que
las explicaciones se entienden pero las valoraciones en caliente dicen
lo contrario, la discrepancia merece reportarse: es habitual que al
responder un cuestionario la gente sea más benévola que en el momento
de uso.

**Ítems de control.** El 18 y el 19 miden confianza desde ángulos
opuestos. Una puntuación alta en ambos es coherente; alta en el 18 y
baja en el 19 sugiere que el participante confía en el sistema cuando
propone pero no cuando calla, que es una asimetría que conviene
discutir.

---

## Nota sobre el alcance de la Fase 3

La validación implementada verifica **propiedades**, no acierto
predictivo. Comprueba que el artefacto nunca viola una restricción
sanitaria, a cuántos lotes da salida, que es determinista, que combinar
lotes compatibles mejora la propuesta y que el ordenamiento no depende
de haber acertado los pesos con precisión.

No mide cuántas de sus recomendaciones coinciden con lo que la operación
hizo después, y conviene declarar por qué. El conjunto de datos
disponible es sintético: las decisiones históricas se generaron
asignando recetas al azar, de modo que no contienen señal recuperable.
Medir acierto contra ruido produce cifras sin significado, altas o bajas
según la casualidad, y presentarlas como resultado sería engañoso.

Esa comparación queda pendiente del conjunto de datos reales del caso de
estudio, con seis meses de producción, asistencia y mermas. Declararlo
como limitación es preferible a reportar un número que no se sostiene.

## Nota sobre el bucle de retroalimentación

La aceptación de cada receta se recalcula a partir de las decisiones
reales, pero no como proporción directa de aprobaciones: se aplica
encogimiento hacia la valoración de partida con un peso previo
equivalente a ocho observaciones.

Sin esa corrección, tres rechazos consecutivos hundirían una receta de
4,4 a 1,0, y el modelo dejaría de proponerla por lo que probablemente
fue una coincidencia. Con el encogimiento, esos mismos tres rechazos la
dejan en 3,3, y hacen falta bastantes más decisiones para moverla de
verdad.

Conviene declarar este criterio en el artículo: es una decisión de
diseño con consecuencias sobre el comportamiento del artefacto, y un
revisor atento preguntará por ella al ver que el modelo aprende de las
decisiones.

## Limitaciones que conviene declarar

- La muestra es de conveniencia y de un solo centro de producción, de
  modo que los resultados no son generalizables a otras operaciones.
- Los participantes conocen el propósito académico del estudio, lo que
  puede inducir respuestas más favorables.
- La sesión usa datos simulados; el juicio sobre la viabilidad de las
  preparaciones se emite sobre casos que no son de su operación real.
- Una sola sesión por participante no permite evaluar si el sistema
  sigue resultando útil con el uso prolongado.
