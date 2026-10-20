# Desplegar FoodLoop en Render

Para que el docente abra un enlace en lugar de instalar nada.
Capa gratuita, sin tarjeta.

## 1. La base de datos en MongoDB Atlas

Render no aloja MongoDB, así que la base vive en Atlas:

1. En **mongodb.com/atlas**, crea un clúster gratuito **M0**, región
   São Paulo.
2. En **Database Access**, crea un usuario con contraseña de solo letras
   y números.
3. En **Network Access**, añade `0.0.0.0/0`. Render se conecta desde
   direcciones que cambian, así que no se puede restringir por IP; la
   base queda protegida por usuario y contraseña.
4. **Connect → Drivers → Node.js** y copia la cadena de conexión.

## 2. El backend y el frontend en Render

1. Entra a **render.com** con la cuenta de GitHub del repositorio.
2. **New → Blueprint** y elige el repositorio `FoodLoop`. Render lee
   `render.yaml` y crea el backend y el frontend.
3. Te pedirá el valor de `MONGODB_URI`: pega la cadena de Atlas con tu
   contraseña.
4. Cuando termine, copia la URL del servicio `foodloop-api`.
5. En el servicio `foodloop-web`, pestaña **Environment**, pon
   `VITE_API` con esa URL y `/api` al final, y pulsa **Manual Deploy**.
   Hace falta recompilar porque Vite incrusta las variables al compilar.
6. La URL de `foodloop-web` es el enlace que compartes.

El backend detecta la base vacía en el primer arranque y carga los datos
de ejemplo solo.

## Aviso para el docente

El plan gratuito duerme el backend tras quince minutos sin uso. La
primera carga después tarda hasta un minuto. Conviene abrir el enlace un
par de minutos antes de la revisión.

Cada `git push` a `main` vuelve a desplegar solo.
