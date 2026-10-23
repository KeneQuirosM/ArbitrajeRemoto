# Despliegue en Vercel + Supabase (paso a paso)

ArbitrajeRemoto se publica así:

- **Supabase** (plan Free): la base de datos Postgres donde se guardan partidos, eventos, equipos y relojes. Se usa **uno de
  tus proyectos de Supabase existentes**: el plan Free permite 2 proyectos activos y ya los tienes ocupados (ver §2).
- **Vercel** (plan Hobby): la web (PWA) y la API `/api/v1`, más una tarea diaria (cron) que mantiene despierta la base de datos.

Los dos planes son gratuitos. **Por verificar:** según sus páginas de precios no deberían pedir tarjeta; si alguno te la pide, para y dímelo. Tu web antigua (`singular-madeleine-7f0bc5.netlify.app`) **no se toca**.

> **Por verificar en tu pantalla:** los nombres exactos de botones y menús de Supabase y Vercel cambian a menudo, y yo no
> puedo abrir sus paneles. Si algo no coincide con lo que ves, dime qué aparece y te indico el equivalente.

---

## 0. Lo que vas a necesitar

- Tu cuenta de **GitHub** con el repositorio `ArbitrajeRemoto` (y el PR ya fusionado en `main`).
- Un **PC con Node.js 22** para generar cuatro valores secretos. (Instalador en https://nodejs.org → versión LTS 22.)
- Un **gestor de contraseñas** o un sitio seguro donde apuntar 5 valores secretos. **Nunca** los pegues en el código, en un
  issue de GitHub ni en un chat.

**Región:** la de Vercel debe ser la misma zona que la de tu proyecto de Supabase (§2.1), para que cada consulta no cruce el
continente. Si algún día creas un proyecto propio, elige **East US (North Virginia)**: es la región que ofrecen **ambos**
servicios más cercana a Costa Rica y Guatemala (ninguno tiene región en México ni en Centroamérica; São Paulo queda más lejos),
y es la que `vercel.json` trae configurada (`iad1`).

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
npm run gen-secret          # (otra vez) → contraseña del usuario de base de datos arbitraje_app (§2.3)
```

Apunta los cuatro valores en tu gestor de contraseñas.

---

## 2. Supabase: usar uno de tus proyectos existentes

El plan Free de Supabase permite **2 proyectos activos en total** (sumando todas tus organizaciones; los pausados no
cuentan). Como ya tienes 2, ArbitrajeRemoto se instala **dentro de uno de ellos**, de forma aislada:

- Sus tablas van en un esquema propio y privado, **`arbitraje`**, separado de las tablas de tu otra app (que normalmente están
  en `public`). No se pisan.
- La API se conecta con un **usuario de base de datos propio, `arbitraje_app`**, que solo puede leer y escribir las tablas de
  `arbitraje`. No puede ver ni tocar los datos de tu otra app, ni crear o borrar tablas. Es lo que recomienda Supabase: un
  usuario por servicio en lugar de compartir la contraseña de `postgres`.
- Comparten los límites del plan (500 MB de base de datos, 5 GB de transferencia al mes). ArbitrajeRemoto ocupa muy poco
  (§4), pero mira cuánto usa tu otra app en **Project → Usage**.
- Ventaja: el cron diario de ArbitrajeRemoto también mantiene despierto ese proyecto.

### 2.1 Elegir el proyecto y ver su región

1. Entra en https://supabase.com/dashboard y elige el proyecto que vayas a compartir (mejor el que tenga menos uso).
2. Mira su región en **Project Settings → General** (o en el selector de proyectos). Apúntala: la necesitarás en §3.4.

### 2.2 Crear las tablas (dos migraciones)

1. En el menú lateral del proyecto, abre **SQL Editor** → **New query**.
2. Abre en GitHub [`supabase/migrations/20261023120000_init.sql`](../supabase/migrations/20261023120000_init.sql), pulsa
   **Raw**, copia todo, pégalo y pulsa **Run**. Debe terminar con "Success".
3. Igual con [`supabase/migrations/20261023130000_app_role.sql`](../supabase/migrations/20261023130000_app_role.sql).
4. Comprobación: **Table Editor** → en el selector de esquema (arriba, pone `public`) elige **`arbitraje`**. Deben aparecer
   `devices`, `events`, `matches`, `meta`, `pairing_codes`, `rate_limits` y `teams`. Las tablas de tu otra app siguen igual en
   `public`.

Las dos migraciones son seguras si se repiten. No tocan nada fuera del esquema `arbitraje`, salvo crear el usuario
`arbitraje_app`.

(Alternativa desde el PC: `DATABASE_URL='<cadena del usuario postgres>' npm run db:migrate`. Usa siempre el mismo método.)

### 2.3 Activar el usuario `arbitraje_app` con su contraseña

En el **SQL Editor**, nueva consulta, pega esto sustituyendo el texto entre comillas por el **tercer `gen-secret`** del paso 1
(deja las comillas simples):

```sql
alter role arbitraje_app with login password 'PEGA-AQUI-EL-TERCER-GEN-SECRET';
```

Pulsa **Run**. La contraseña queda guardada solo en la base de datos y en tu gestor; no va al repositorio.

Comprobación de aislamiento (opcional, recomendada). Sustituye `nombre_de_una_tabla_tuya` por una tabla de tu otra app:

```sql
select has_table_privilege('arbitraje_app', 'public.nombre_de_una_tabla_tuya', 'select') as ve_tu_otra_app,
       has_table_privilege('arbitraje_app', 'arbitraje.events', 'select') as ve_sus_eventos;
```

Debe dar `ve_tu_otra_app = false` y `ve_sus_eventos = true`.

### 2.4 Copiar la cadena de conexión (`DATABASE_URL`)

1. Arriba, en la página del proyecto, pulsa **Connect**.
2. Elige **Transaction pooler** (puerto **6543**), el modo que Supabase recomienda para funciones serverless como las de Vercel.
3. Copia la URI. Se parece a:
   `postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres`
4. Cámbiala así (según la documentación de Supabase, con un usuario propio el nombre es `usuario.id-del-proyecto`):
   - `postgres.abcdefghijkl` → **`arbitraje_app.abcdefghijkl`** (mismo id de proyecto, cambia solo la primera parte);
   - `[YOUR-PASSWORD]` (con los corchetes) → la contraseña del paso 2.3.

   Resultado: `postgresql://arbitraje_app.abcdefghijkl:TU-CONTRASEÑA@aws-0-us-east-1.pooler.supabase.com:6543/postgres`
5. Guárdala como **`DATABASE_URL`**.

**Seguridad:** la API solo conoce esta cadena (usuario `arbitraje_app`), que va únicamente en las variables de entorno de
Vercel. La web nunca la ve, y no se usan la contraseña de `postgres`, la "anon key" ni la "service_role key". Las tablas
tienen Row Level Security activado; las únicas políticas son para `arbitraje_app`, y los roles públicos de Supabase (`anon`,
`authenticated`) no tienen ningún permiso.

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

1. **Functions → Function Region:** tiene que coincidir con la región de tu proyecto de Supabase (§2.1):

   | Región de Supabase | Región de Vercel |
   |---|---|
   | East US (North Virginia), `us-east-1` | Washington, D.C. (`iad1`), la que ya trae `vercel.json` |
   | East US (Ohio), `us-east-2` | Cleveland (`cle1`) |
   | West US (North California), `us-west-1` | San Francisco (`sfo1`) |
   | West EU (Ireland), `eu-west-1` | Dublin (`dub1`) |
   | Otra | La de la misma ciudad en la lista de Vercel (São Paulo `sa-east-1` → São Paulo `gru1`, etc.) |

   Si no es `iad1`, **dime cuál es** y cambio `"regions"` en `vercel.json`. Si solo la cambias en el panel, `vercel.json` la
   volvería a poner en el siguiente despliegue.
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
| Tamaño de la base | 500 MB **por proyecto, compartidos con tu otra app** | Un partido con 100 eventos ocupa unos 50 KB: miles de partidos |
| Transferencia de salida | 5 GB al mes | Muy por debajo |
| Proyectos activos | 2 (sumando todas tus organizaciones; los pausados no cuentan) | 0 nuevos: comparte uno de los tuyos |
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
- **Cambiar la contraseña de `arbitraje_app`:** genera una con `npm run gen-secret`, ejecuta en el SQL Editor
  `alter role arbitraje_app with password '...';`, actualiza `DATABASE_URL` en Vercel y redespliega.
  (La contraseña de `postgres` es de tu proyecto y ArbitrajeRemoto no la usa: cambiarla no le afecta.)
- **Si algún día quieres un proyecto solo para ArbitrajeRemoto:** crea el proyecto, repite §2.2–2.4 en él, cambia
  `DATABASE_URL` en Vercel y copia los datos (te ayudo con eso cuando llegue el momento).
- **Si Supabase pausó el proyecto** (correo "project paused"): panel de Supabase → el proyecto → **Resume project**. Los datos
  se conservan.
- **Relojes:** se revocan uno a uno desde la web (Bloque 3) o con `DELETE /api/v1/devices/{keyId}`.

## 6. Problemas frecuentes

| Síntoma | Causa probable | Solución |
|---|---|---|
| `SERVER_MISCONFIGURED` | Falta una variable de entorno | Revisa las 4 del paso 3.3 y redespliega |
| `/api/v1/...` responde 500 y en Logs pone `password authentication failed` | `DATABASE_URL` con la contraseña mal puesta (o con corchetes) | Vuelve al paso 2.4 |
| Logs: `Tenant or user not found` | Usuario de la cadena incorrecto | El usuario debe ser `arbitraje_app.<id-del-proyecto>` (§2.4) |
| Logs: `password authentication failed for user "arbitraje_app"` | Falta el paso 2.3 o la contraseña no coincide | Repite §2.3 y actualiza `DATABASE_URL` |
| Logs: `permission denied for schema arbitraje` | Falta la segunda migración | §2.2, punto 3 |
| Logs: `relation "arbitraje.matches" does not exist` | No se aplicaron las migraciones | §2.2 |
| El cron devuelve 401 | `CRON_SECRET` no está definido en Vercel | Añádelo y redespliega |
