# Despliegue en Vercel + Supabase (paso a paso)

ArbitrajeRemoto se publica así:

- **Supabase** (plan Free): la base de datos Postgres donde se guardan partidos, eventos, equipos y relojes.
- **Vercel** (plan Hobby): la web (PWA) y la API `/api/v1`, más una tarea diaria (cron) que mantiene despierta la base de datos.

Los dos planes son gratuitos. **Por verificar:** según sus páginas de precios no deberían pedir tarjeta; si alguno te la pide, para y dímelo. Tu web antigua (`singular-madeleine-7f0bc5.netlify.app`) **no se toca**.

> **Por verificar en tu pantalla:** los nombres exactos de botones y menús de Supabase y Vercel cambian a menudo, y yo no
> puedo abrir sus paneles. Si algo no coincide con lo que ves, dime qué aparece y te indico el equivalente.

---

## 0. Lo que vas a necesitar

- Tu cuenta de **GitHub** con el repositorio `ArbitrajeRemoto` (y el PR ya fusionado en `main`).
- Un **PC con Node.js 22** para generar tres valores secretos. (Instalador en https://nodejs.org → versión LTS 22.)
- Un **gestor de contraseñas** o un sitio seguro donde apuntar 5 valores secretos. **Nunca** los pegues en el código, en un
  issue de GitHub ni en un chat.

Región elegida: **este de EE. UU. (Virginia del Norte)**, en los dos servicios: Supabase `us-east-1` y Vercel `iad1`
(Washington, D.C., la misma zona). Es la región que ofrecen **ambos** más cercana a Costa Rica y Guatemala (ninguno tiene
región en México ni en Centroamérica; São Paulo queda más lejos). Tener la función y la base en la misma zona evita que cada
consulta cruce el continente.

---

## 1. Genera tus secretos (en el PC)

En la carpeta del proyecto (`git clone` del repositorio y luego `npm ci`):

```bash
npm run hash-passphrase     # pide tu frase de acceso dos veces (no se ve al escribir)
```

Copia la línea que empieza por `scrypt$...` → es **`ADMIN_PASSPHRASE_HASH`**. La frase en sí no se guarda en ningún sitio:
usa una larga que recuerdes (4 o más palabras).

```bash
npm run gen-secret          # → SESSION_SECRET
npm run gen-secret          # (otra vez) → CRON_SECRET
```

Apunta los tres valores en tu gestor de contraseñas.

---

## 2. Supabase: crear la base de datos

### 2.1 Cuenta

1. Entra en https://supabase.com y pulsa **Start your project**.
2. Elige **Continue with GitHub** y autoriza.
3. Si te pide crear una **organización**, ponle tu nombre y elige el plan **Free**.

### 2.2 Proyecto

1. **New project**.
2. **Name:** `ArbitrajeRemoto`.
3. **Database Password:** pulsa **Generate a password**, cópiala y guárdala en tu gestor (la necesitarás en el paso 2.4).
4. **Region:** elige **East US (North Virginia)**. Si solo ves regiones generales ("Americas"), busca la opción de región
   específica y elige `us-east-1`.
5. Plan **Free** → **Create new project**. Tarda un par de minutos.

### 2.3 Crear las tablas (migración)

**Opción A (recomendada, sin instalar nada):**

1. En el menú lateral del proyecto, abre **SQL Editor** → **New query**.
2. Abre en GitHub el archivo [`supabase/migrations/20261023120000_init.sql`](../supabase/migrations/20261023120000_init.sql),
   pulsa **Raw**, copia todo y pégalo en el editor.
3. Pulsa **Run**. Debe terminar con "Success. No rows returned".
4. Comprobación: **Table Editor** → en el selector de esquema (arriba, pone `public`) elige **`arbitraje`**. Deben aparecer
   las tablas `devices`, `events`, `matches`, `meta`, `pairing_codes`, `rate_limits` y `teams`, todas con el aviso de
   **RLS enabled**.

**Opción B (desde el PC):** con la cadena del paso 2.4 en `DATABASE_URL`:

```bash
DATABASE_URL='postgresql://...' npm run db:migrate
```

Usa siempre la misma opción para futuras migraciones. Las dos son seguras si se repiten.

### 2.4 Copiar la cadena de conexión (`DATABASE_URL`)

1. Arriba, en la página del proyecto, pulsa **Connect**.
2. Elige **Transaction pooler** (puerto **6543**). Es el modo que Supabase recomienda para funciones serverless como las de Vercel.
3. Copia la URI. Se parece a:
   `postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres`
4. Sustituye `[YOUR-PASSWORD]` (incluidos los corchetes) por la contraseña del paso 2.2. Si la contraseña tiene símbolos
   como `@`, `#` o `/`, genera otra sin símbolos en **Project Settings → Database → Reset database password**.
5. Guárdala como **`DATABASE_URL`**.

**Seguridad:** esta cadena es la llave de tu base de datos. Solo irá en las variables de entorno de Vercel. La web nunca la
ve, y no hace falta usar la "anon key" ni la "service_role key" de Supabase: la API se conecta directamente a Postgres desde
el servidor. Las tablas están en un esquema privado (`arbitraje`) que la API pública de Supabase no expone, con Row Level
Security activado y sin políticas, y a los roles públicos (`anon`, `authenticated`) se les quitan todos los permisos.

---

## 3. Vercel: publicar la web y la API

### 3.1 Cuenta

1. Entra en https://vercel.com/signup.
2. Elige **Hobby** (uso personal) y **Continue with GitHub**.

### 3.2 Importar el repositorio

1. En el panel: **Add New… → Project**.
2. En **Import Git Repository**, busca `ArbitrajeRemoto`. Si no aparece, pulsa **Adjust GitHub App Permissions** y da acceso
   a ese repositorio.
3. **Import**.

### 3.3 Configurar antes del primer despliegue

- **Framework Preset:** `Other`.
- **Root Directory:** `./` (sin cambiar).
- **Build and Output Settings:** no toques nada; se leen de `vercel.json` (`npm run build`, carpeta `web/dist`).
- **Environment Variables:** añade las cuatro, una por una (nombre exacto, valor sin comillas):

| Nombre | Valor |
|---|---|
| `DATABASE_URL` | la cadena del paso 2.4 |
| `ADMIN_PASSPHRASE_HASH` | la línea `scrypt$...` del paso 1 |
| `SESSION_SECRET` | el primer `gen-secret` |
| `CRON_SECRET` | el segundo `gen-secret` |

  Si al añadirlas te deja elegir entorno, márcalas solo para **Production**. Si ofrece marcarlas como **Sensitive**, márcalas.

Pulsa **Deploy** y espera a que termine (1–2 minutos).

### 3.4 Ajustes del proyecto (una vez)

En el proyecto, **Settings**:

1. **Functions → Function Region:** debe decir **Washington, D.C., USA (iad1)**. `vercel.json` ya lo pide; si ves otra, cámbiala.
2. **Despliegues de vista previa:** no hace falta hacer nada. `vercel.json` incluye un *Ignored Build Step* que cancela todo
   despliegue que no sea de producción (rama `main`). Así no gastan cuota ni podrían tocar la base de datos real. En
   **Settings → Git → Ignored Build Step** verás que lo controla `vercel.json`.
3. **Domains:** tu dirección será algo como `https://arbitrajeremoto.vercel.app`. Puedes cambiar el subdominio ahí.

### 3.5 Comprobar

- `https://<tu-proyecto>.vercel.app/` → se abre la web (lista de partidos).
- `https://<tu-proyecto>.vercel.app/api/v1/health` → `{"ok":true,...}`.
- Desde el PC (crea datos de prueba y los borra al final):
  ```bash
  BASE=https://<tu-proyecto>.vercel.app/api/v1 PASSPHRASE='tu frase' bash examples/curl.sh
  BASE=https://<tu-proyecto>.vercel.app/api/v1 PASSPHRASE='tu frase' npm run seed   # datos de ejemplo que se quedan
  ```

Si la API responde `SERVER_MISCONFIGURED`, falta una variable de entorno o está mal copiada. Corrígela en **Settings →
Environment Variables** y vuelve a desplegar (**Deployments → … → Redeploy**).

### 3.6 La tarea diaria (cron)

- **Settings → Cron Jobs** debe listar `/api/cron/keepalive` con el horario `17 13 * * *`: una vez al día, sobre las 13:17 UTC
  (7:17 en Costa Rica y Guatemala). En Hobby la hora puede variar dentro de esa hora.
- Puedes probarla con el botón **Run**. En **Logs** verás una respuesta `200` con `"ok":true`.
- Hace tres consultas pequeñas a la base (y borra códigos de vinculación caducados). Sirve para que Supabase no considere el
  proyecto inactivo.

---

## 4. Límites de los planes gratuitos (verificados)

Comprobado el 23-10-2026 en la documentación oficial: la de Supabase leída en su repositorio público (`supabase/supabase`), y
la de Vercel en sus páginas de docs a través de un buscador restringido a `vercel.com` (desde mi entorno no se pueden abrir
directamente).

**Vercel Hobby**

| Concepto | Límite | Uso esperado de ArbitrajeRemoto |
|---|---|---|
| Uso permitido | Solo **personal y no comercial**: nada de cobrar a usuarios, anuncios, cobrar por alojar el sitio ni venderlo como servicio | Herramienta personal de un árbitro: encaja (confirmado contigo) |
| Invocaciones de funciones | 1.000.000 al mes | Del orden de decenas de miles (la app sincroniza cada 30 s mientras está abierta) |
| CPU activa | 4 horas de CPU al mes | Cada petición usa milisegundos |
| Duración máxima de una función | 300 s (aquí limitada a 15 s en `vercel.json`) | Las peticiones tardan menos de 1 s |
| Transferencia (Fast Data Transfer) | 100 GB al mes | La app pesa unos 30 KB comprimida; respuestas pequeñas |
| Cron jobs | Hasta 100 por proyecto, cada uno **como máximo 1 vez al día**, con hora aproximada | 1 diario |
| Registros (logs) | Se guardan 1 hora | — |
| Si se supera algo | Hay que esperar a que se renueve el periodo (30 días) | Muy lejos de los límites |

**Supabase Free**

| Concepto | Límite | Uso esperado |
|---|---|---|
| Tamaño de la base | 500 MB | Un partido con 100 eventos ocupa unos 50 KB: miles de partidos |
| Transferencia de salida | 5 GB al mes | Muy por debajo |
| Proyectos activos | 2 | 1 |
| CPU / RAM | Compartida, 500 MB | Suficiente |
| **Pausa por inactividad** | Se pausa tras **1 semana** sin actividad suficiente de base de datos. Avisa por correo una semana antes. Se puede reanudar hasta 1 año después desde el panel (**Resume project**) | El cron diario hace varias consultas al día. La guía de Supabase dice que "normalmente unas pocas peticiones al día durante la semana" bastan |

Fuentes: [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Vercel Limits](https://vercel.com/docs/limits),
[Functions limits](https://vercel.com/docs/functions/limitations), [Cron jobs: usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing),
[Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs), [Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines),
[Supabase pricing](https://supabase.com/pricing), [Supabase project pausing](https://supabase.com/docs/guides/platform/free-project-pausing),
[Supabase regions](https://supabase.com/docs/guides/platform/regions), [Connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres).

### Mide el consumo real

Anota lo que marcan los paneles (**Vercel → Usage**, **Supabase → Project → Usage / Reports**) antes y después:

| Acción | Invocaciones Vercel | Transferencia Vercel | Tamaño BD Supabase |
|---|---|---|---|
| `examples/curl.sh` completo | | | |
| `npm run seed` | | | |
| 1 partido completo desde la web | | | |
| 1 semana normal | | | |

---

## 5. Mantenimiento

- **Cambiar la frase de acceso:** repite `npm run hash-passphrase`, reemplaza `ADMIN_PASSPHRASE_HASH` en Vercel y redespliega.
- **Cerrar sesión en todos los dispositivos:** reemplaza `SESSION_SECRET` y redespliega.
- **Cambiar la contraseña de la base:** Supabase → **Project Settings → Database → Reset database password**. Después
  actualiza `DATABASE_URL` en Vercel y redespliega.
- **Si Supabase pausó el proyecto** (correo "project paused"): panel de Supabase → el proyecto → **Resume project**. Los datos
  se conservan.
- **Relojes:** se revocan uno a uno desde la web (Bloque 3) o con `DELETE /api/v1/devices/{keyId}`.

## 6. Problemas frecuentes

| Síntoma | Causa probable | Solución |
|---|---|---|
| `SERVER_MISCONFIGURED` | Falta una variable de entorno | Revisa las 4 del paso 3.3 y redespliega |
| `/api/v1/...` responde 500 y en Logs pone `password authentication failed` | `DATABASE_URL` con la contraseña mal puesta (o con corchetes) | Vuelve al paso 2.4 |
| Logs: `Tenant or user not found` | Usuario de la cadena incorrecto | Copia de nuevo la URI de **Transaction pooler** (el usuario es `postgres.<id-del-proyecto>`) |
| Logs: `relation "arbitraje.matches" does not exist` | No se aplicó la migración | Paso 2.3 |
| El cron devuelve 401 | `CRON_SECRET` no está definido en Vercel | Añádelo y redespliega |
