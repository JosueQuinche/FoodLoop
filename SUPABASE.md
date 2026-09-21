# Conectar FoodLoop a Supabase

Supabase es PostgreSQL gestionado. El esquema del proyecto funciona sin
cambios: lo único que varía es la cadena de conexión.

La ventaja para este trabajo es que nadie tiene que instalar nada. Tú, tu
cliente y el docente apuntan a la misma base y ven los mismos datos.

## Pasos

**1.** Entra a [supabase.com](https://supabase.com) y crea una cuenta.

**2.** **New project**. Ponle nombre `foodloop`, elige la región más
cercana (South America para Ecuador) y **define una contraseña de base de
datos**. Anótala: no se puede ver después, solo restablecer.

**3.** Espera a que el proyecto quede listo, un par de minutos.

**4.** Pulsa **Connect** arriba. En la pestaña de cadenas de conexión elige
**Session pooler** y copia la que aparece. Tiene esta forma:

```
postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
```

Usa **Session pooler**, no Transaction pooler: el backend mantiene una
piscina de conexiones y el modo de transacción no admite sentencias
preparadas, que es lo que usa el controlador `pg`.

**5.** En `backend/.env`, pon esa cadena reemplazando `[YOUR-PASSWORD]` por
tu contraseña real:

```
DATABASE_URL=postgresql://postgres.abcdefgh:TU_CLAVE@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
PORT=3001
```

Si la contraseña lleva `@`, `#`, `/` o `%`, codifícala: la arroba es `%40`.

**6.** Crea las tablas y carga los datos:

```bash
npm run semilla
```

Se conecta a Supabase, aplica el esquema y siembra. No hace falta crear la
base: Supabase ya trae una llamada `postgres`.

**7.** Arranca:

```bash
npm run dev
```

## Ver los datos

En el panel de Supabase, **Table Editor** muestra las tablas con su
contenido, y **SQL Editor** permite consultas. Es el equivalente a pgAdmin,
en el navegador.

Para el diagrama entidad-relación: **Database** → **Schema Visualizer**.

## Qué cambia respecto a PostgreSQL local

Nada en el código ni en el esquema. El proyecto detecta por la cadena de
conexión si la base es remota y activa TLS, que Supabase exige. También
reduce el tamaño de la piscina, porque los planes gestionados limitan el
número de conexiones simultáneas.

## Precaución

La cadena de conexión contiene la contraseña de la base. Vive en
`backend/.env`, que está excluido del repositorio. No la pegues en el
código ni la compartas en capturas.

Si necesitas dar acceso a tu cliente, compártele la cadena por un canal
privado, o créale su propio proyecto en Supabase con el mismo esquema.
