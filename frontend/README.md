# FoodLoop · React + TypeScript · Arquitectura hexagonal

Prototipo funcional del modelo de aprovechamiento de mermas alimentarias
en catering industrial, organizado en puertos y adaptadores.

## Ejecutar

```bash
npm install
npm run dev          # desarrollo
npm run verificar    # comprueba la regla de dependencias
npm run build        # verifica, tipa y compila a dist/
```

## Capas

```
src/
  dominio/                      No conoce a nadie. Cero dependencias externas.
    modelo/tipos.ts             Entidades y tipos del negocio
    servicios/motor.ts          Correspondencia y explicabilidad (Fase 2)
    servicios/autorizacion.ts   Política de permisos por rol
    puertos/entrada/            Casos de uso que el sistema ofrece
    puertos/salida/             Interfaces que el dominio exige

  aplicacion/casos-uso/         Orquesta dominio + puertos. Sin reglas propias.

  infraestructura/
    adaptadores/salida/memoria/ Repositorios en memoria (validación)
    adaptadores/salida/http/    Repositorios contra la API (producción)
    configuracion/contenedor.ts Composition root: único punto con clases concretas

  ui/                           Adaptador de entrada. Invoca casos de uso y pinta.
```

## La regla de dependencias

Las flechas apuntan hacia adentro:

| Capa | Puede depender de |
|---|---|
| dominio | nada |
| aplicacion | dominio |
| infraestructura | aplicacion, dominio |
| ui | dominio, infraestructura (solo el tipo del contenedor) |

`npm run verificar` la comprueba sobre el árbol completo y falla la
compilación si alguien la rompe. También impide que el dominio importe
React. Sin esa comprobación automática la arquitectura se degrada en la
primera urgencia.

## Cambiar de memoria a API

Una variable de entorno:

```bash
VITE_MODO=http VITE_API=https://api.foodloop.ec npm run build
```

El contenedor instancia `LotesHttp` en lugar de `LotesEnMemoria`. Ni el
dominio, ni los casos de uso, ni la interfaz cambian una línea. Esa es la
propiedad que hace rentable la arquitectura cuando el proyecto escala.

## Por qué encaja con este modelo

El artículo declara que la lógica de correspondencia debe ser agnóstica
respecto del catálogo. Hexagonal lleva esa exigencia al nivel de la
estructura del código: el motor recibe elementos disponibles y
alternativas que declaran requisitos, sin saber que unos son mermas y
otras recetas. Sustituir el dominio culinario por otro no requiere tocar
`dominio/servicios/motor.ts`.

La autorización vive en el dominio, no en la interfaz. Si mañana se añade
una API REST o una tarea programada como adaptadores de entrada, quedan
cubiertos por la misma regla sin reimplementarla.

## Casos didácticos

`generarLotes()` fuerza tres lotes para las sesiones de validación:

1. Pechuga cocida a 3,2 °C con 18 h de vida útil. Caso idóneo.
2. Crema de leche a 8,4 °C. Cadena de frío rota: solo sobreviven los
   reprocesos térmicos sobre 74 °C.
3. Lechuga sin dictamen sanitario. Cero recomendaciones y diez descartes
   registrados con su motivo.

Los dos últimos existen para mostrar que el modelo sabe decir que no.

## Relación con la implementación en Python

La versión Python conserva el esquema relacional, el generador de seis
meses de histórico y los scripts de validación de las Fases 3 y 4. Esta
versión es el artefacto que los usuarios manipulan durante la evaluación.
