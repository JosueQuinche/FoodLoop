# Datos del centro, en documentos de MongoDB

Generado con `npm run exportar:mongo` a partir de `./datos`.
Son los mismos documentos que escribe `npm run importar -- ./datos`:
se producen con el mismo código, sobre una base en memoria, y se
vuelcan después.

## Contenido

| Colección | Documentos | Archivo |
| --- | ---: | --- |
| areas | 5 | areas.json |
| servicios | 11 | servicios.json |
| ingredientes | 127 | ingredientes.json |
| recetas | 208 | recetas.json |
| operacion_diaria | 751 | operacion_diaria.json |
| mermas | 1577 | mermas.json |

Las fechas van como `{"$date": "..."}` (JSON extendido canónico). En
texto plano los validadores `$jsonSchema` rechazarían los documentos y
el motor no podría comparar vencimientos.

No se exportan:

- `usuarios`: lleva hashes de contraseña; se crean con `npm run semilla`
- `recomendaciones`: las genera el uso del prototipo, no la importación
- `decisiones`: las genera el uso del prototipo, no la importación

## Cómo cargarlos

Primero cree las colecciones con sus validadores e índices, desde la
raíz del proyecto:

```
npm run esquema
```

Importar sin ese paso también funciona, pero las colecciones quedan sin
validadores ni índices: MongoDB aceptaría después documentos que el
modelo considera inválidos.

Después, desde esta carpeta:

```
mongoimport --db foodloop --collection areas --file areas.json --jsonArray --drop
mongoimport --db foodloop --collection servicios --file servicios.json --jsonArray --drop
mongoimport --db foodloop --collection ingredientes --file ingredientes.json --jsonArray --drop
mongoimport --db foodloop --collection recetas --file recetas.json --jsonArray --drop
mongoimport --db foodloop --collection operacion_diaria --file operacion_diaria.json --jsonArray --drop
mongoimport --db foodloop --collection mermas --file mermas.json --jsonArray --drop
```

`--drop` reemplaza la colección. Quítelo si quiere añadir en lugar de
reemplazar.

## La vía recomendada

Si tiene el proyecto a mano, esto es más simple y hace lo mismo:

```
npm run importar -- ./datos
```

Conecta, aplica el esquema y escribe las colecciones en un solo paso.
