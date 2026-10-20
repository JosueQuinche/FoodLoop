# Datos del centro de producción

Estos seis CSV son la entrada exacta con que se produjeron las evidencias
del informe. Se generaron a partir de
`FoodLoop_Dataset_6_Meses_Recetas_Aprovechamiento_Ampliadas.xlsx`
(16 hojas, periodo 2026-01-01 a 2026-06-30) con:

```bash
npm run datos:convertir -- "ruta/al/dataset.xlsx" ./datos
```

Para cargarlos y evaluar el modelo sobre ellos no hace falta volver a
convertir nada:

```bash
npm run datos:evaluar -- ./datos
```

## Qué es documental y qué no

El libro de origen declara su propia procedencia en cada fila, y conviene
no perderla de vista:

| Hoja de origen | Filas | Lo que el libro declara |
| --- | --- | --- |
| Catálogo de ingredientes | 127 | `ORIGINAL_RECETARIO_MAREMIO` — documental |
| Receta-ingrediente | 1 162 | 600 documentales, 562 complementarias o no validadas |
| Servicios diarios | 543 | `RECONSTRUCCIÓN_REFERENCIAL` |
| Producción diaria | 758 | `RECONSTRUCCIÓN_REFERENCIAL` |
| Lotes de merma | 1 577 | `RECONSTRUCCIÓN_REFERENCIAL` |
| Decisiones de merma | 1 577 | `RECONSTRUCCIÓN_REFERENCIAL` |
| Control de inocuidad | 1 577 | `RECONSTRUCCIÓN_REFERENCIAL` |
| Inventario diario | 1 182 | `Estimación referencial` |
| Recetas desde mermas | 53 | `PROPUESTA_SIMULADA` |

Solo el recetario y el catálogo de ingredientes son documentales. La
serie temporal es una reconstrucción, y el informe lo declara así.

## Campos que el libro no trae medidos

En las 1 577 filas de merma, el libro dice:

- temperatura de generación — «No documentada»
- temperatura de almacenamiento — «No documentada»
- hora de generación — «No documentada»
- dictamen sanitario — «No evaluado»
- estado de ejecución de la decisión — «No autorizada»

Ninguno de esos valores se inventó. Cada uno se deriva de una columna que
el libro sí trae, con una regla escrita en
`herramientas/dataset/convertir.py`:

| Campo | Regla de derivación |
| --- | --- |
| `temperatura_c` | Del almacenamiento declarado: cámara refrigerada → 4 °C; área de segregación → 18 °C |
| `apto_reproceso` | De la condición de inocuidad declarada → 71 aptos, 182 no aptos, 1 324 pendientes |
| `vida_util_*` | De la categoría del ingrediente |
| `cantidad` de receta | 112 de 208 recetas declaraban más de 1,8 veces en ingredientes el peso del plato que rinden; se normalizaron conservando las proporciones |

El valor `pendiente` de `apto_reproceso` es el tercer estado del
dictamen: el lote no fue examinado y rechazado, es que nadie lo examinó.
El modelo no lo autoriza, pero sí calcula su potencial de
aprovechamiento y dice qué falta medir.

## Supuestos que conviene corregir si la cocina los aclara

El libro no dice de qué producto se trata en tres casos, que suman 370
lotes (23 % del total). El convertidor los asigna así y lo reporta aparte:

- «verduras cocidas» → zanahoria
- «sopa sobrante» → papa
- «fruta recortada» y «fruta sana recortada» → frutilla

Cambiarlos es editar la tabla `PRODUCTO_A_INGREDIENTE` del convertidor.

## Lo que sigue faltando

La variable objetivo: qué hizo realmente la cocina con cada lote. La hoja
de decisiones trae `ESTADO_EJECUCION = "No autorizada"` en las 1 577
filas, de modo que no hay con qué ajustar los pesos del modelo ni contra
qué comparar sus propuestas. Mientras eso no exista, lo que se puede
hacer es verificación —el modelo cumple lo que promete— y no validación.
