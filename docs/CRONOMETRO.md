# Cronómetro: algoritmo y casos límite

El cronómetro **nunca se guarda como segundos acumulados**. Solo existen eventos con marca de tiempo
(`period_start`, `period_pause`, `period_resume`, `period_end`, `match_end`) y el tiempo se recalcula con
una función pura (`core/derive.ts`, probada en `core/derive.test.ts` y `core/clock.test.ts`).
Si el móvil o el reloj se duermen, se reinician o se quedan sin batería, al volver basta con recalcular:
no se pierde nada.

## 1. Tiempo efectivo de cada evento

```
t = Date.parse(clientTimestamp) + clockOffsetMs
```

- `clientTimestamp`: hora UTC del dispositivo cuando ocurrió el evento (se guarda tal cual).
- `clockOffsetMs`: corrección por lote (ver §4). Normalmente 0.
- Orden total: por `t`; en empate (mismo milisegundo), por `id`. **El orden de llegada no influye.**

## 2. Máquina de estados

Se recorren los eventos válidos (sin `void` ni anulados) en orden:

| Fase actual | Evento | Condición | Nueva fase | Efecto en el reloj |
|---|---|---|---|---|
| antes del inicio | `period_start` | `period = 1` | en juego | `elapsed = 0`, `anchor = t` |
| descanso | `period_start` | `period = anterior + 1` y `≤ periods` | en juego | `elapsed = 0`, `anchor = t` |
| en juego | `period_pause` | — | pausado | `elapsed += t − anchor` |
| pausado | `period_resume` | — | en juego | `anchor = t` |
| en juego / pausado | `period_end` | `period = actual` | descanso, o terminado si era el último | se congela `elapsed` |
| cualquiera salvo terminado | `match_end` | — | terminado | se congela `elapsed` |
| — | `added_time` | — | (igual) | guarda los minutos anunciados del periodo |

Cualquier otra combinación (reanudar sin pausa, empezar el periodo 2 sin terminar el 1, etc.) **se guarda pero se ignora**
y queda en `warnings`. Así un toque doble o un evento desordenado nunca rompe el estado.

`status` se deriva de la fase: antes del inicio → `scheduled`; en juego o pausado → `live`; descanso → `halftime`; terminado → `finished`.

## 3. Tiempo y minuto

- Tiempo jugado del periodo en el instante `now`: `elapsedMs + (running ? now − anchorAt : 0)` (nunca negativo).
- Minuto de fútbol (`minuteLabel`), con `P = periodMinutes` y `n` = periodo:
  - `m = floor(tiempo / 60 s) + 1` (de 0:00 a 0:59 es el minuto 1).
  - Si `m ≤ P`: `(n − 1)·P + m` → "1" … "45", "46" … "90".
  - Si `m > P`: `"{n·P}+{m − P}"` → "45+1", "90+3". (45:00 jugados ya es "45+1".)
- El minuto de cada evento se calcula con el tiempo jugado en su `t`. Un evento durante una pausa toma el minuto en el que se pausó;
  durante el descanso, el del final del periodo anterior; antes del inicio no tiene minuto.
- `matchMinute` que envía el cliente es solo informativo; manda el calculado.

## 4. Relojes de dispositivo desfasados

Cada lote lleva `sentAt` (hora del dispositivo al **enviar**). El servidor calcula:

```
offset = horaServidor − sentAt
clockOffsetMs = |offset| > 30 s ? offset : 0
```

y lo aplica a todos los eventos del lote.

- **Desfase pequeño (≤ 30 s):** se ignora. Es latencia de red o deriva normal, y así los eventos de un mismo dispositivo conservan
  exactamente sus distancias entre sí (lo que importa para el cronómetro).
- **Reloj claramente adelantado o atrasado (> 30 s):** se corrige. Ejemplo: reloj 10 min adelantado; los eventos llegan con horas
  10 min en el futuro y `sentAt` también; `offset = −10 min` los devuelve a su hora real.
- **Por qué funciona sin conexión:** el desfase de un dispositivo es prácticamente constante durante un partido, así que el `sentAt`
  medido al sincronizar (aunque sea horas después) sirve para corregir eventos registrados antes.
- **Límite conocido:** si la hora del dispositivo **cambia a mitad de partido** (p. ej. se sincroniza con el móvil entre dos eventos), los eventos
  anteriores y posteriores al cambio quedan con distinta base. Mitigación en el cliente: medir el tiempo con un reloj monotónico
  (`SystemClock.elapsedRealtime()` en Android) desde el inicio del periodo y calcular `clientTimestamp = horaInicio + transcurrido`.
  Se detalla en `docs/GUIA_RELOJ.md`.
- Tras corregir, un evento más de 5 min en el futuro se rechaza (`timestamp_in_future`); uno de hace más de 30 días, también (`timestamp_too_old`).
- Para **mostrar** el cronómetro, el cliente calcula su propio desfase con `serverTime` (o la cabecera `Date`):
  `ahoraServidor ≈ ahoraLocal + (serverTime − horaLocalAlRecibir)`, porque `anchorAt` está en hora del servidor.

## 5. Casos límite cubiertos por tests

| Caso | Resultado |
|---|---|
| Pausa de 3 min en el primer tiempo | No cuenta: gol a los 20 min reales es el minuto "18" |
| Tiempo añadido | Fin del primer tiempo con 47:00 jugados → "45+3"; `addedMinutes` informa lo anunciado |
| Segundo tiempo | Empieza en "46" |
| Suspensión (`match_end` a mitad de periodo) | Estado `finished`, tiempo congelado |
| Eventos en orden aleatorio, en 1 o varios lotes | Mismo estado exacto (20 permutaciones probadas) |
| `period_resume` sin pausa, `period_start` 2 sin terminar el 1 | Ignorados con aviso |
| Periodo mayor que `periods` | Rechazado al recibir (`period_out_of_range`) |
| Deshacer el inicio (`void` de `period_start`) | Vuelve a `scheduled` |
| Reloj 10 min adelantado | Corregido con `sentAt` |
| `now` anterior a `anchorAt` (relojes de distintos dispositivos) | Tiempo nunca negativo |
