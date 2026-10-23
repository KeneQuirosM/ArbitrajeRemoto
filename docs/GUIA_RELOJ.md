# Guía para la app del reloj (ArbitrajeRemoto Reloj)

Esta guía es para quien programe la app de Wear OS que usa la API de ArbitrajeRemoto. Explica qué tiene que hacer el
reloj, en qué orden y qué hacer cuando algo falla. El contrato completo está en [`docs/API.md`](API.md) y en
[`openapi.yaml`](../openapi.yaml), y el cronómetro en [`docs/CRONOMETRO.md`](CRONOMETRO.md). Si esta guía y `API.md` no
coinciden, manda `API.md`.

> **Marcado "por verificar":** todo lo que depende del reloj real, del teléfono o de tus cuentas no se pudo probar
> desde aquí. Hay que comprobarlo con el reloj en la mano (lista al final, §12).

---

## 1. Resumen en 30 segundos

1. **Vincular una sola vez:** el reloj pide un código y lo muestra. Tú lo escribes en la web (**Ajustes → Relojes**). El reloj
   recibe su clave (`deviceKey`) y la guarda cifrada.
2. **Pitar sin internet:** el reloj crea el partido y los eventos con ids que genera él mismo (UUID), los guarda en su memoria y
   muestra el marcador al momento.
3. **Enviar cuando haya conexión:** manda la cola de eventos en lotes. Todo es **idempotente**: reenviar lo mismo no duplica
   nada, así que se puede reintentar siempre.

---

## 2. Conexión a internet del reloj

### ⚠️ Importante: el Galaxy Watch 4 necesita un teléfono Android

Según el soporte oficial de Samsung, la serie Galaxy Watch4 **solo se puede configurar con un teléfono Android** (usa la app
Galaxy Wearable y los servicios de Google Play, que no existen en iOS). **No se puede vincular a un iPhone.**
Fuente: [Samsung, "Galaxy Watch4 serisi iOS cihazlarla uyumlu mu?"](https://www.samsung.com/tr/support/mobile-devices/is-the-galaxy-watch4-series-compatible-with-ios-devices/)
y [compatibilidad de relojes Samsung](https://www.samsung.com/ae/support/mobile-devices/samsung-smart-watch-and-phone-compatibility/).

La web de ArbitrajeRemoto funciona en el iPhone sin problema. El **reloj** necesita su propio teléfono Android para la
configuración inicial. **Por verificar:** con qué teléfono está configurado ahora tu reloj.

### Por dónde sale a internet

Según la [documentación de Wear OS sobre acceso a la red](https://developer.android.com/training/wearables/data/network-access):

- Si el reloj tiene Bluetooth con su teléfono, el tráfico **pasa por el teléfono** ("proxied through the phone").
- Si no, usa **Wi‑Fi** (o datos móviles en modelos LTE; el tuyo no los tiene). El sistema cambia de red solo.
- La app hace peticiones **HTTP normales**. **No** uses la Data Layer API para hablar con la API.
- No existen `android.webkit` ni `CookieManager`. No pasa nada: el reloj **no usa cookies**, solo la cabecera
  `Authorization`.
- Para trabajo en segundo plano (enviar la cola cuando vuelva la red), la documentación recomienda **WorkManager** con la
  restricción de red `CONNECTED`.

En la cancha, lo habitual es una de estas dos opciones. Las dos están **por verificar**:

| Situación | Cómo tiene internet el reloj |
|---|---|
| Llevas el teléfono Android en el bolsillo | Por Bluetooth, a través del teléfono |
| Solo llevas el iPhone | Activa **Compartir Internet** en el iPhone y conecta el reloj a esa Wi‑Fi (Ajustes del reloj → Conexiones → Wi‑Fi) |
| Sin nada | La app funciona igual. Todo se guarda y se envía después |

**La app nunca debe depender de tener red para registrar un evento.**

---

## 3. Configuración

| Dato | Valor |
|---|---|
| URL base | `https://arbitraje-remoto.vercel.app/api/v1` (tu dirección de Vercel; solo HTTPS) |
| Formato | JSON UTF‑8. Las peticiones con cuerpo llevan `Content-Type: application/json` |
| Autenticación | `Authorization: Bearer <deviceKey>` en **todas** las peticiones, salvo `/health` y `/pairing/*` |
| Tiempo de espera | 15 s por petición (la señal en la cancha es débil). Si se agota, se reintenta más tarde |

### `deviceId`: el identificador de esta instalación

- Genéralo **una sola vez**, en el primer arranque, y guárdalo. Por ejemplo: `watch-` + un UUID.
- Reglas del servidor: 1–64 caracteres, solo `A–Z a–z 0–9 . _ -`.
- Si vinculas otra vez el **mismo** `deviceId`, el servidor revoca sus claves anteriores. Por eso no lo cambies.

---

## 4. Vincular el reloj (una vez)

El reloj no tiene teclado numérico, así que el código se **muestra en el reloj** y se **escribe en la web**.

```
Reloj                                   API                                  Web (tú, con sesión)
  │ POST /pairing/request ───────────────▶│                                        │
  │◀─ 201 {code, pollToken, expiresAt} ───│                                        │
  │ muestra "K7M 3QX"                     │                                        │
  │                                       │◀── POST /pairing/approve {code} ───────│ Ajustes → Relojes
  │ POST /pairing/poll (cada 5 s) ───────▶│                                        │
  │◀─ 202 pending … 200 {deviceKey} ──────│                                        │
  │ guarda deviceKey cifrada              │                                        │
```

### 4.1 Pedir el código

```http
POST /pairing/request
Content-Type: application/json

{ "deviceId": "watch-5b1c9f0e-…", "deviceName": "Galaxy Watch 4" }
```

Respuesta `201`:

```json
{ "code": "K7M3QX", "pollToken": "…", "expiresAt": "2026-10-25T16:10:00.000Z", "pollIntervalSeconds": 5 }
```

- `deviceName` es opcional (máx. 40 caracteres). Se puede cambiar desde la web al aprobar.
- El código tiene 6 caracteres de `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (sin 0/O ni 1/I/L, para que no se confundan). Caduca a
  los **10 minutos** y solo sirve **una vez**.
- **Pantalla del reloj:** muéstralo grande, en dos grupos (`K7M 3QX`), con una cuenta atrás y el texto
  "Escríbelo en la web: Ajustes → Relojes".
- `pollToken` es secreto: guárdalo en memoria y no lo muestres.
- `429`: se pidieron más de 10 códigos en 10 minutos. Espera lo que diga `Retry-After`.

### 4.2 Esperar la aprobación

Cada `pollIntervalSeconds` (5 s):

```http
POST /pairing/poll
Content-Type: application/json

{ "code": "K7M3QX", "pollToken": "…" }
```

| Respuesta | Qué hacer |
|---|---|
| `202 { "status": "pending" }` | Seguir esperando |
| `200 { "status": "approved", "deviceKey": "ark1_…", "keyId", "deviceId", "deviceName" }` | Guardar `deviceKey` (§4.3), mostrar "Vinculado ✓" y dejar de preguntar |
| `410 CODE_EXPIRED` | Caducó: ofrecer "Pedir otro código" |
| `410 CODE_USED` | La clave ya se entregó. Si el reloj no la recibió (se cortó la red justo entonces), pedir **otro** código |
| `404` | `pollToken` incorrecto: pedir otro código |
| Error de red | Reintentar en 5 s, sin salir de la pantalla |

La clave se entrega **una sola vez**. Guárdala antes de mostrar "Vinculado".

### 4.3 Guardar la clave

- La `deviceKey` da acceso a tus partidos: trátala como una contraseña. **Nunca** la escribas en logs ni la muestres.
- Cífrala con una clave del **Android Keystore** (`javax.crypto.KeyGenerator` con el proveedor `AndroidKeyStore`) y guarda
  el resultado cifrado en `SharedPreferences` o DataStore. Excluye ese archivo de la copia de seguridad automática.
- **No uses `EncryptedSharedPreferences`** (`androidx.security:security-crypto`): Google marcó toda esa librería como
  obsoleta en la versión 1.1.0 y no tendrá más versiones
  ([notas de la versión](https://developer.android.com/jetpack/androidx/releases/security),
  [criptografía en Android](https://developer.android.com/privacy-and-security/cryptography)).
  **Por verificar:** el código exacto, contra esa documentación, cuando se programe la app.

### 4.4 Cuando la clave deja de servir

Si cualquier petición devuelve **`401`**, la clave fue revocada (la desvinculaste en la web) o se volvió a vincular el reloj:

1. Deja de enviar, pero **no borres la cola**: los eventos siguen guardados.
2. Muestra "Reloj desvinculado. Vuelve a vincularlo" y vuelve a §4.1.
3. Con la clave nueva, la cola se envía igual (todo es idempotente).

---

## 5. Qué puede hacer el reloj

| Puede | No puede (`403`) |
|---|---|
| `GET /matches`, `GET /matches/{id}`, `GET /matches/{id}/events` | Editar o borrar partidos (`PATCH`, `DELETE`) |
| `POST /matches` (partido rápido o con equipos) | Editar equipos |
| `POST /matches/{id}/events` | Vincular o revocar relojes |
| `GET /teams` (plantillas, para elegir dorsales) | Ver la lista de dispositivos |
| `GET /session` (comprobar la clave) | |

---

## 6. Partido rápido sin conexión

1. Genera un UUID para el partido (`UUID.randomUUID()`) y guárdalo **antes** de nada.
2. Muestra el marcador al momento: "Local 0 – 0 Visitante".
3. Pon en la cola la creación:

```http
POST /matches
Authorization: Bearer ark1_…
Content-Type: application/json

{ "id": "0b0e3a1c-…", "deviceId": "watch-5b1c9f0e-…" }
```

- Sin equipos ni nombres, el servidor crea **"Local" contra "Visitante"**, a 2 tiempos de 45 minutos. Puedes mandar
  `homeTeamName`, `awayTeamName`, `periods` (1–4) y `periodMinutes` (1–60) si el árbitro los elige en el reloj.
- `201`: creado. `200` con `duplicate: true`: **ya existía** (un reintento). Las dos respuestas son un éxito.
- `409 ID_CONFLICT`: ese id ya existe con **otros** datos. No debería pasar si el cuerpo de la creación nunca cambia: guarda
  el cuerpo exacto la primera vez y reenvía **siempre el mismo**.
- `410`: el dueño borró el partido en la web. Deja de enviarlo y márcalo como borrado.
- La creación tiene que llegar **antes** que sus eventos: en la cola, envía primero las creaciones y luego los eventos.
  (Si llegan eventos de un partido que no existe, la respuesta es `404`: reintenta después de crear el partido.)

---

## 7. Eventos

### 7.1 Cómo registrar un evento

Cada toque del árbitro crea **un evento inmutable** con:

- `id`: un UUID nuevo, que es la **clave de idempotencia**;
- `clientTimestamp`: la **hora real UTC** del reloj en ese momento, en ISO 8601 (`Instant.now().toString()`);
- los campos de su tipo (tabla de §7.2).

Se guarda en la base de datos local **primero**: se actualiza la pantalla y se añade a la cola. Nunca se modifica después.
Para **deshacer**, se crea otro evento `void` que apunta al anterior.

Para que dos eventos del reloj nunca compartan el milisegundo (por ejemplo, con un toque doble), usa
`t = max(ahora, último_t + 1)`.

### 7.2 Tipos y campos

| `type` | Campos obligatorios | Opcionales | Ejemplo |
|---|---|---|---|
| `period_start` | `period` | | `{"type":"period_start","period":1}` |
| `period_pause` / `period_resume` | | `period` | `{"type":"period_pause"}` |
| `period_end` | `period` | | `{"type":"period_end","period":1}` |
| `added_time` | `minutes` (0–30) | `period` | `{"type":"added_time","minutes":3}` |
| `match_end` | | | `{"type":"match_end"}` (también para suspender) |
| `goal` | `team` | `playerNumber` (1–99) | `{"type":"goal","team":"home","playerNumber":9}` |
| `own_goal` | `team` (equipo **del jugador**; suma al rival) | `playerNumber` | `{"type":"own_goal","team":"away","playerNumber":4}` |
| `yellow_card` / `red_card` | `team` | `playerNumber` | `{"type":"yellow_card","team":"away","playerNumber":4}` |
| `substitution` | `team`, `playerOutNumber`, `playerInNumber` (distintos) | | `{"type":"substitution","team":"home","playerOutNumber":10,"playerInNumber":14}` |
| `note` | `text` (1–500) | `team`, `playerNumber` | `{"type":"note","text":"Banquillo protesta"}` (privada: no sale en la vista en vivo) |
| `void` | `voidsEventId` | | `{"type":"void","voidsEventId":"1d9e…"}` |

`team` es `"home"` (local) o `"away"` (visitante). Todos llevan además `id` y `clientTimestamp`.

La segunda amarilla del mismo jugador se convierte en roja **automáticamente** al derivar el estado. No mandes una roja extra.

### 7.3 Enviar la cola

```http
POST /matches/{matchId}/events
Authorization: Bearer ark1_…
Content-Type: application/json

{
  "sentAt": "2026-10-25T16:40:00.000Z",
  "events": [
    { "id": "8b0c…", "type": "period_start", "period": 1, "clientTimestamp": "2026-10-25T16:00:02.000Z" },
    { "id": "1d9e…", "type": "goal", "team": "home", "playerNumber": 9, "clientTimestamp": "2026-10-25T16:12:40.000Z" }
  ]
}
```

- **`sentAt`:** hora del reloj **en el momento de enviar**. Recalcúlala en **cada** reintento. Con ella el servidor detecta un
  reloj desajustado (más de 30 s) y corrige el lote.
- Con clave de reloj no hace falta `deviceId` (se toma de la clave). Si lo mandas y no coincide, la respuesta es `403`.
- Máximo **200 eventos** y 64 KB por lote. Si hay más, envía varios lotes.
- Envía **un partido por petición** y respeta el orden de la cola, aunque el servidor ordena por tiempo y no por llegada.

Respuesta `200`, también cuando se rechaza algún evento:

```json
{
  "results": [
    { "id": "8b0c…", "status": "accepted" },
    { "id": "1d9e…", "status": "duplicate" }
  ],
  "state": { "status": "live", "score": { "home": 1, "away": 0 }, "clock": { … }, "discipline": [], "lastSeq": 2 },
  "clockOffsetMs": 0,
  "serverTime": "2026-10-25T16:40:00.120Z"
}
```

| `status` de cada evento | Qué hacer |
|---|---|
| `accepted` | Quitarlo de la cola |
| `duplicate` | Ya estaba (un reintento): quitarlo de la cola |
| `rejected` (con `reason`) | Quitarlo de la cola y marcarlo como "rechazado" en el reloj. **No** reintentarlo tal cual: el rechazo es definitivo |

| Respuesta HTTP | Qué hacer |
|---|---|
| `200` | Procesar `results` como arriba |
| Error de red, timeout, `5xx`, `429`, `503 BUSY` | Dejar la cola como está y reintentar más tarde (§7.4) |
| `401` | §4.4 |
| `404` | Falta la creación del partido: enviarla primero |
| `410` | Partido borrado en la web: dejar de enviar sus eventos |
| `413` | Lote demasiado grande: partirlo |

### 7.4 Reintentos

- Al registrar un evento, intenta enviar enseguida si hay red.
- Si falla, espera con retroceso exponencial: 5 s, 10 s, 20 s… hasta 5 min. Al volver la red o abrir la app, reintenta al
  momento.
- En segundo plano, usa WorkManager con la restricción de red `CONNECTED`.
- Como todo es idempotente, **reintentar nunca duplica**. Ante la duda, reintenta.

---

## 8. Cronómetro en el reloj

- El reloj **nunca guarda segundos acumulados**. Calcula el tiempo con los eventos de reloj (`period_start`, pausas,
  `period_end`, `match_end`), igual que el servidor. La función de referencia es [`core/derive.ts`](../core/derive.ts), con
  pruebas en `core/derive.test.ts`, y las fórmulas están en [`docs/CRONOMETRO.md`](CRONOMETRO.md).
- Tiempo jugado del periodo = `elapsedMs + (running ? ahora − anchorAt : 0)`.
- Minuto: `45+2` cuando pasa del tiempo reglamentario (`core/clock.ts`, `minuteLabel`).
- Si el reloj se duerme o se reinicia, al volver basta con recalcular. No se pierde nada.
- Para comparar con la hora del servidor: `GET /health` devuelve `serverTime`, y desfase = `serverTime − hora del reloj`
  (usa el punto medio de la petición). Úsalo **solo para mostrar** el estado que venga del servidor. Los eventos llevan
  siempre la hora **del reloj** en `clientTimestamp`, y el servidor la corrige con `sentAt`.

---

## 9. Leer datos del servidor

- **Partidos del día:**
  `GET /matches?status=scheduled,live&fields=homeTeamName,awayTeamName,scheduledAt,status,score,periods,periodMinutes`.
  Respuesta pequeña, buena para la lista del reloj.
- **Un partido con sus eventos** (por ejemplo, si lo empezaste en la web): `GET /matches/{id}?include=events`. Para lo nuevo
  desde la última vez: `GET /matches/{id}/events?since=<lastSeq>`.
- **Plantillas:** `GET /teams`. Guárdalas en el reloj para elegir dorsales sin conexión.
- Guarda en el reloj lo que leas. Si no hay red, muestra lo último guardado.

---

## 10. Pantallas sugeridas para un reloj sin teclado numérico

Son ideas, **por verificar** en el reloj real:

- **Dorsal:** si el partido tiene plantilla, una lista de dorsales (con nombre) para elegir con el bisel o deslizando. Si no la
  tiene, un selector de 1 a 99 que se gira con el bisel, más la opción **"Sin dorsal"** (`playerNumber` se omite).
- **Botones grandes:** Gol, Amarilla y Roja por equipo, y un botón de cronómetro (Iniciar/Pausar/Reanudar). Mantener pulsado
  para las acciones raras (fin del tiempo, terminar).
- **Deshacer:** muestra qué se va a deshacer ("¿Deshacer gol de Local, 9?") y crea un `void`.
- **Estado de envío:** un punto pequeño (verde = todo enviado, ámbar = N pendientes, gris = sin red).
- **Vibración** al registrar cada evento, para confirmar sin mirar.

---

## 11. Límites y errores

| Límite | Valor |
|---|---|
| Eventos por lote | 200 (64 KB) |
| Eventos por partido | 2000 |
| `clientTimestamp` | hasta 5 min en el futuro (tras corregir) y hasta 30 días en el pasado |
| Códigos de vinculación | 10 cada 10 min por IP; 240 consultas de `poll` cada 10 min |
| Texto de nota | 500 caracteres |
| `deviceName` | 40 caracteres |

Todos los errores tienen la forma `{ "error": { "code", "message", "details"? } }`. La lista completa está en
[`API.md`](API.md#errores).

### Probar sin el reloj (curl)

Con `curl` puedes hacer exactamente lo que hará el reloj. Hay un ejemplo completo en
[`examples/curl.sh`](../examples/curl.sh): pide un código, lo aprueba como dueño, recoge la clave, crea un partido rápido,
envía eventos (también repetidos) y revoca la clave.

```bash
BASE=https://arbitraje-remoto.vercel.app/api/v1 PASSPHRASE='tu frase' bash examples/curl.sh
```

---

## 12. Pruebas manuales con el reloj (por verificar)

1. **Vincular:** en el reloj, "Vincular" → aparece un código. En la web: **Ajustes → Relojes**, escribe el código (prueba en
   minúsculas y con guion) → "Vincular reloj". En unos segundos el reloj dice "Vinculado" y la web lo lista (pulsa
   "Actualizar" si no aparece).
2. **Código caducado:** pide un código y espera 10 minutos sin aprobarlo. La web dice "El código caducó" y el reloj ofrece
   pedir otro.
3. **Partido rápido sin red:** con el reloj en modo avión (sin teléfono ni Wi‑Fi cerca), crea un partido rápido, inicia el 1.er
   tiempo, registra un gol y una amarilla. El marcador cambia al momento.
4. **Sincronizar sin duplicados:** vuelve a dar red al reloj (por el teléfono o por Compartir Internet del iPhone). En la web,
   en **Partidos**, aparece "Local – Visitante" con 1–0. Fuerza varios envíos (sal y entra en la app): el partido y sus
   eventos siguen apareciendo **una sola vez**. En Neon, `select count(*) from arbitraje.events where match_id = '<id>';`
   devuelve 3.
5. **Vista en vivo:** abre el partido en la web → "Compartir en vivo" → ábrelo en otro teléfono. Registra un gol en el
   reloj. En la vista en vivo aparece en menos de ~20 s (lo que tarde el reloj en enviarlo más 10 s).
6. **Deshacer desde el reloj:** deshaz el último gol. El marcador vuelve atrás en el reloj, en la web y en la vista en vivo.
7. **Desvincular:** en la web, **Relojes → Desvincular**. La siguiente petición del reloj recibe `401`: el reloj pide vincularse
   otra vez **sin perder** los eventos que tenía pendientes.
8. **Batería y reposo:** con el cronómetro en marcha, deja que el reloj apague la pantalla 2 minutos. Al despertarlo, el tiempo
   es correcto.
9. **Hora del reloj mal puesta:** adelanta la hora del reloj 10 minutos (si el sistema lo permite), registra un gol y envíalo.
   En la web aparece en el minuto correcto, porque el servidor lo corrige con `sentAt`.
