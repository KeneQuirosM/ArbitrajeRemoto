# ArbitrajeRemoto — API v1

Contrato de la API que usan la web y la app del reloj (ArbitrajeRemoto Reloj).
La especificación formal está en [`openapi.yaml`](../openapi.yaml) y hay ejemplos ejecutables en
[`examples/curl.sh`](../examples/curl.sh). Para la app del reloj, lee también [`docs/GUIA_RELOJ.md`](GUIA_RELOJ.md).

- **URL base:** `https://<tu-proyecto>.vercel.app/api/v1` (solo HTTPS). En local: `http://localhost:8787/api/v1`.
- **Formato:** JSON UTF-8. Las peticiones con cuerpo llevan `Content-Type: application/json` (si no, `415`).
- **Fechas:** ISO 8601 con zona explícita (`2026-10-25T16:05:00.000Z` o `...+02:00`). El servidor devuelve siempre UTC (`Z`).
- **Ids:** UUID (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`). Los genera el cliente para partidos, eventos, equipos y jugadores; así se pueden crear sin conexión y reintentar sin duplicar.
- **Versionado:** todo cuelga de `/api/v1`. Cambios compatibles (campos nuevos) no cambian la versión; los clientes deben ignorar campos que no conozcan.

## Autenticación

| Quién | Cómo | Puede |
|---|---|---|
| Propietario (web) | `POST /session` con la frase de acceso → cookie `ar_session` (`HttpOnly; Secure; SameSite=Strict`, 30 días) | Todo |
| Reloj | `Authorization: Bearer ark1_<keyId>_<secreto>` (la `deviceKey` de la vinculación) | Leer partidos y equipos, crear partidos, leer y escribir eventos |
| Cualquiera | Enlace con `token` | Solo `GET /matches/{id}/live` |
| Cualquiera | — | `GET /health`, `POST /pairing/request`, `POST /pairing/poll` |

- La frase de acceso nunca se guarda: el servidor solo conoce su hash scrypt (`ADMIN_PASSPHRASE_HASH`).
- Las `deviceKey` se guardan como SHA-256 y se pueden revocar (`DELETE /devices/{keyId}`). Al vincular de nuevo el mismo reloj (`deviceId`), sus claves anteriores se revocan.
- `DELETE /session` borra la cookie del navegador. Para invalidar **todas** las sesiones, cambia `SESSION_SECRET` en Vercel y vuelve a desplegar.

## Errores

Siempre el mismo formato:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid input: invalid_periodMinutes", "details": { "reason": "invalid_periodMinutes" } } }
```

| HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `BAD_REQUEST` | JSON mal formado, parámetro de consulta inválido |
| 401 | `UNAUTHORIZED` | Sin credenciales, sesión caducada, clave revocada, frase incorrecta |
| 403 | `FORBIDDEN` | Credenciales válidas pero sin permiso (p. ej. el reloj intenta `PATCH`) |
| 404 | `NOT_FOUND` | No existe (o el token de la vista en vivo no coincide) |
| 405 | `METHOD_NOT_ALLOWED` | Método no soportado en esa ruta (cabecera `Allow`) |
| 409 | `ID_CONFLICT` / `CONFLICT` | El id ya existe con otro contenido / conflicto de estado |
| 410 | `GONE` / `CODE_USED` / `CODE_EXPIRED` | Partido borrado / código ya usado / código caducado |
| 413 | `PAYLOAD_TOO_LARGE` | Cuerpo > 16 KB (64 KB en lotes de eventos) o > 200 eventos |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Falta `Content-Type: application/json` |
| 422 | `VALIDATION_ERROR` | Dato inválido; `details.reason` dice cuál |
| 429 | `RATE_LIMITED` | Demasiados intentos; cabecera `Retry-After` en segundos |
| 500 | `SERVER_MISCONFIGURED` / `INTERNAL` | Faltan variables de entorno / error inesperado |
| 503 | `BUSY` | Demasiadas escrituras simultáneas; reintentar (`Retry-After`) |

Límites de frecuencia (por IP, ventana fija): 5 frases incorrectas / 15 min; 10 códigos de vinculación pedidos / 10 min;
240 consultas de vinculación / 10 min; 10 códigos incorrectos al aprobar / 10 min.

## Modelo de datos

### Match

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | Lo puede generar el cliente |
| `homeTeamId`, `awayTeamId` | uuid \| null | Equipo con plantilla, opcional |
| `homeTeamName`, `awayTeamName` | string (1–60) | Copia del nombre; por defecto `Local` / `Visitante` |
| `scheduledAt` | fecha \| null | |
| `periods` | 1–4 | Por defecto 2 |
| `periodMinutes` | 1–60 | Por defecto 45 |
| `tournament` | string (≤ 80) \| null | |
| `createdAt`, `updatedAt` | fecha | Puestas por el servidor |
| `createdByDeviceId` | string \| null | Quién lo creó |
| `liveToken` | string | Solo lo ve el propietario |

El **estado no se guarda**: `status` (`scheduled | live | halftime | finished`), marcador, cronómetro y tarjetas se
derivan siempre de los eventos con la función pura `core/derive.ts`.

### Team

`{ id, name (1–60), players: [{ id, number (1–999, único en el equipo), name (≤ 60) | null }], createdAt, updatedAt }`, máx. 60 jugadores.

### Event (inmutable)

Lo que envía el cliente:

| Campo | Tipos de evento | Notas |
|---|---|---|
| `id` | todos | uuid generado en el dispositivo: **clave de idempotencia** |
| `type` | — | ver tabla siguiente |
| `team` | goal, own_goal, yellow_card, red_card, substitution (obligatorio); note (opcional) | `home` \| `away` |
| `playerNumber` | goal, own_goal, cards, note (opcional) | 1–999 |
| `playerOutNumber`, `playerInNumber` | substitution (obligatorios, distintos) | 1–999 |
| `text` | note (obligatorio) | 1–500 caracteres, se permiten saltos de línea |
| `period` | period_start, period_end (obligatorio); period_pause, period_resume, added_time (opcional) | 1..`periods` del partido |
| `minutes` | added_time (obligatorio) | 0–30 |
| `voidsEventId` | void (obligatorio) | id del evento a anular |
| `clientTimestamp` | todos (obligatorio) | Hora real UTC del dispositivo cuando ocurrió |
| `matchMinute` | todos (opcional) | Minuto que mostró el cliente; informativo |
| `deviceId` | todos (opcional) | Si falta, se usa el del lote / la clave del reloj |
| `matchId` | todos (opcional) | Si viene, debe coincidir con la URL |

Los campos que no aplican al tipo se ignoran (se guardan como `null`).

| `type` | Significado |
|---|---|
| `goal` | Gol del equipo `team` |
| `own_goal` | Gol en propia puerta de un jugador de `team`: **suma al rival** |
| `yellow_card` / `red_card` | Tarjeta; la segunda amarilla del mismo jugador se deriva como roja |
| `substitution` | Cambio: sale `playerOutNumber`, entra `playerInNumber` |
| `note` | Nota libre **privada** (nunca sale en la vista en vivo) |
| `period_start` / `period_end` | Inicio / fin del periodo `period` |
| `period_pause` / `period_resume` | Detiene / reanuda el cronómetro |
| `added_time` | Tiempo añadido anunciado (`minutes`) del periodo actual o de `period` |
| `match_end` | Fin del partido en cualquier momento (p. ej. suspensión) |
| `void` | Anula `voidsEventId` ("deshacer"). Un `void` no puede anular otro `void` |

El servidor añade: `seq` (orden de llegada, creciente por partido), `createdAt`, `clockOffsetMs` y `t`
(`clientTimestamp` corregido, en ms desde epoch, usado para ordenar y para el cronómetro; ver `docs/CRONOMETRO.md`).

## Endpoints

### Sistema

- `GET /health` → `200 { ok, version, serverTime }`. Público. Sirve para comprobar conexión y para estimar el desfase del reloj.

### Sesión

- `POST /session` `{ passphrase }` → `200 { authenticated, role: "owner", expiresAt }` + `Set-Cookie`. `401` si la frase es incorrecta; `429` tras 5 fallos.
- `GET /session` → `{ authenticated: false }` o `{ authenticated: true, role: "owner" }` o `{ authenticated: true, role: "device", deviceId, keyId }`.
- `DELETE /session` → `204` (borra la cookie).

### Partidos

- `GET /matches?status=scheduled,live&fields=homeTeamName,awayTeamName,scheduledAt,status` → `{ matches: [...], serverTime }`.
  Sin paginación. `status` filtra (lista separada por comas). `fields` reduce la respuesta (`id` siempre va). Campos posibles:
  `id, homeTeamId, awayTeamId, homeTeamName, awayTeamName, scheduledAt, tournament, periods, periodMinutes, status, score, createdAt, updatedAt, lastSeq`.
  Orden: `scheduledAt` (o `createdAt` si no hay) ascendente.
- `POST /matches` `{ id?, homeTeamId?, awayTeamId?, homeTeamName?, awayTeamName?, scheduledAt?, periods?, periodMinutes?, tournament?, deviceId? }`
  → `201 { match, state, duplicate: false }`. **Idempotente por `id`:** reenviar la misma petición devuelve `200 { ..., duplicate: true }`
  aunque el propietario haya editado el partido después; mismo `id` con otros datos → `409 ID_CONFLICT`; partido borrado → `410`.
  Sin equipos ni nombres se crea "Local" vs "Visitante" (partido rápido desde el reloj).
- `GET /matches/{id}?include=events,timeline` → `{ match, state, events?, timeline?, warnings?, serverTime }`.
- `PATCH /matches/{id}` (solo propietario) mismos campos que al crear + `rotateLiveToken: true` para invalidar el enlace en vivo anterior.
- `DELETE /matches/{id}` (solo propietario) → `204`. Se guarda una marca de borrado para que un reenvío del reloj no lo resucite.

`state` (compacto):

```json
{
  "status": "live",
  "score": { "home": 1, "away": 0 },
  "clock": { "period": 1, "running": true, "elapsedMs": 600000, "anchorAt": 1792944780000, "addedMinutes": null },
  "discipline": [{ "team": "away", "playerNumber": 4, "yellow": 1, "red": false, "secondYellow": false }],
  "lastSeq": 7
}
```

Tiempo jugado del periodo actual = `elapsedMs + (running ? ahora − anchorAt : 0)`, con `ahora` en la hora del servidor
(ver `serverTime` y `docs/CRONOMETRO.md`).

### Eventos

`POST /matches/{id}/events`

```json
{
  "deviceId": "web-3f2a",
  "sentAt": "2026-10-25T16:40:00.000Z",
  "events": [
    { "id": "8b0c…", "type": "period_start", "period": 1, "clientTimestamp": "2026-10-25T16:00:02.000Z" },
    { "id": "1d9e…", "type": "goal", "team": "home", "playerNumber": 9, "clientTimestamp": "2026-10-25T16:12:40.000Z" }
  ]
}
```

- `deviceId`: obligatorio con sesión de propietario (id de instalación de la web). Con clave de reloj se toma de la clave; si se envía y no coincide → `403`.
- `sentAt`: hora del dispositivo **en el momento de enviar** (recalcúlala en cada reintento). Si difiere más de 30 s de la del servidor se corrige el lote.
- 0–200 eventos, cuerpo ≤ 64 KB. Un lote vacío sirve para leer el estado.

Respuesta `200` (también si algunos eventos se rechazan):

```json
{
  "results": [
    { "id": "8b0c…", "status": "accepted" },
    { "id": "1d9e…", "status": "duplicate" },
    { "id": "77aa…", "status": "rejected", "reason": "invalid_playerNumber" }
  ],
  "state": { "status": "live", "score": { "home": 1, "away": 0 }, "clock": { … }, "discipline": [], "lastSeq": 2 },
  "clockOffsetMs": 0,
  "serverTime": "2026-10-25T16:40:00.120Z"
}
```

Reglas:

1. **Idempotencia:** un `id` ya guardado con el mismo contenido → `duplicate` (no cambia nada). Con contenido distinto → `rejected: id_conflict`.
2. **Reintentos ilimitados y en cualquier orden:** el estado se calcula ordenando por tiempo (`t`, y después `id`), no por llegada.
3. **Rechazos posibles** (`reason`): `invalid_*` / `missing_*` (validación), `same_player_in_and_out`, `text_too_long`, `cannot_void_itself`,
   `cannot_void_a_void`, `id_conflict`, `match_mismatch`, `device_mismatch`, `period_out_of_range`, `timestamp_in_future` (> 5 min tras corregir),
   `timestamp_too_old` (> 30 días), `match_event_limit` (2000 por partido). Un rechazo es definitivo: **no** reintentes ese evento tal cual.
4. Los eventos que no encajan en la secuencia del cronómetro (p. ej. `period_resume` sin pausa) **se guardan** pero se ignoran al derivar; aparecen en `warnings` de `GET /matches/{id}?include=timeline`.
5. Un `void` cuyo objetivo aún no ha llegado se acepta y se aplica cuando llegue.

`GET /matches/{id}/events?since=<seq>` → `{ events (seq > since, ordenados por seq), lastSeq, state, serverTime }`. `since` por defecto 0.

### Vista en vivo (pública)

`GET /matches/{id}/live?token=<liveToken>` → equipos, torneo, `periods`, `periodMinutes`, `state` (`status, score, clock, lastSeq`) y
`timeline` sin notas, sin `deviceId` ni datos del propietario. Token incorrecto → `404`.
Devuelve `ETag`; con `If-None-Match` igual responde `304` sin cuerpo (consulta cada 10 s sin gastar transferencia).

### Equipos

- `GET /teams` → `{ teams }` (propietario y reloj).
- `PUT /teams/{id}` `{ name, players: [{ id?, number, name? }] }` (propietario) → `201` si es nuevo, `200` si reemplaza. Envía los `id` de jugador para que se conserven.
- `DELETE /teams/{id}` → `204`. Los partidos conservan su copia del nombre.

### Vinculación del reloj (código mostrado en el reloj, aprobado en la web)

1. Reloj: `POST /pairing/request` `{ deviceId, deviceName? }` → `201 { code, pollToken, expiresAt, pollIntervalSeconds: 5 }`.
   `code`: 6 caracteres de `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (sin 0/O ni 1/I/L), caduca en 10 minutos. El reloj lo muestra en pantalla.
2. Web (propietario): `POST /pairing/approve` `{ code, deviceName? }` → `200 { status: "approved", deviceId, deviceName }`.
   Acepta minúsculas, espacios y guiones. Errores: `404` (no existe), `410 CODE_EXPIRED`, `410 CODE_USED`, `429` tras 10 fallos.
3. Reloj, cada `pollIntervalSeconds`: `POST /pairing/poll` `{ code, pollToken }` →
   - `202 { status: "pending", expiresAt }` mientras no se apruebe;
   - `200 { status: "approved", deviceKey, keyId, deviceId, deviceName }` **una sola vez**;
   - `410 CODE_USED` si ya se entregó la clave, `410 CODE_EXPIRED` si caducó, `404` si el `pollToken` no corresponde.
   Si la respuesta con la clave se pierde, el código queda gastado: el reloj pide uno nuevo.

### Dispositivos

- `GET /devices` (propietario) → `{ devices: [{ keyId, deviceId, deviceName, createdAt, lastSeenAt, revokedAt }] }` (`lastSeenAt` con resolución de 1 h).
- `DELETE /devices/{keyId}` (propietario) → `204`. La clave deja de funcionar al momento (`401`).

## Seguridad (resumen)

- Solo HTTPS (Vercel; cabecera HSTS en `vercel.json`). La cookie es `Secure`, `HttpOnly`, `SameSite=Strict` y limitada a `/api`.
- Toda entrada se valida (tipos, rangos de dorsal 1–999, longitudes) y el texto se limpia de caracteres de control. El texto se guarda tal cual y
  **se escapa al mostrarlo** (la web nunca usa `innerHTML` con datos).
- Sin CORS: la API solo se usa desde su propio dominio (la web) o desde la app nativa del reloj.
- Secretos solo en variables de entorno de Vercel; nada en el repositorio (ver `docs/DESPLIEGUE.md`).
