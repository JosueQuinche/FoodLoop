# Desplegar FoodLoop en Render

Para que el docente abra un enlace en lugar de instalar PostgreSQL.
Capa gratuita, sin tarjeta.

## Pasos

**1.** Entra a [render.com](https://render.com) y regístrate con la cuenta
de GitHub que tiene el repositorio.

**2.** En el panel, pulsa **New** y elige **Blueprint**.

**3.** Selecciona el repositorio `FoodLoop`. Render detecta `render.yaml` y
muestra las tres piezas que va a crear: la base de datos, el backend y el
frontend. Confirma con **Apply**.

**4.** Espera a que termine, entre cinco y diez minutos la primera vez. El
backend detecta que la base está vacía y carga el catálogo solo.

**5.** Copia la URL del servicio `foodloop-api`. Tendrá esta forma:

```
https://foodloop-api.onrender.com
```

**6.** Entra al servicio `foodloop-web`, pestaña **Environment**, y pon la
variable `VITE_API` con esa URL y `/api` al final:

```
VITE_API = https://foodloop-api.onrender.com/api
```

Guarda y pulsa **Manual Deploy**. Hace falta recompilar porque las
variables de Vite se incrustan en el momento de la compilación, no se leen
en tiempo de ejecución.

**7.** Abre la URL de `foodloop-web`. Ese es el enlace que compartes.

## Actualizaciones

Cada `git push` a la rama `main` vuelve a desplegar solo. No hay que tocar
nada en Render.

## Lo que debes advertir al docente

El plan gratuito duerme el backend tras quince minutos sin uso. La primera
carga después de ese reposo tarda entre treinta segundos y un minuto. Si la
página aparece vacía o con un aviso de conexión, basta esperar y recargar.

Conviene abrir el enlace un par de minutos antes de la revisión para que el
servidor ya esté despierto.

## Comprobar que el backend responde

```
https://foodloop-api.onrender.com/api/salud
```

Debe devolver `{"estado":"ok","version":"1.0.0"}`.
