# ArbitrajeRemoto Reloj (Wear OS)

App de Wear OS para el **Galaxy Watch 4** que registra el partido en el reloj, sin red, y lo envía a la API de este
repositorio cuando hay conexión. Sigue [`docs/GUIA_RELOJ.md`](../docs/GUIA_RELOJ.md) y el contrato de
[`docs/API.md`](../docs/API.md). Paquete: `app.arbitrajeremoto.reloj`.

> Todo lo que depende del reloj real está marcado **por verificar** en [`docs/PRUEBAS.md`](docs/PRUEBAS.md).

## Qué hace

| Bloque | Contenido |
|---|---|
| R1 | Vincular con un código de 6 letras (se escribe en la web: **Ajustes → Relojes**). Clave cifrada con AES/GCM del Android Keystore. Ajuste «Servidor». |
| R2 | Partido rápido sin conexión: marcador, cronómetro derivado de los eventos, gol/amarilla/roja con dorsal en un teclado numérico, autogol, cambio, tiempo añadido, deshacer. |
| R3 | Cola de envío idempotente (envío inmediato + WorkManager con red), punto de estado verde/ámbar/gris, pruebas de contrato contra la API real. |
| R4 | Partidos del día (`GET /matches`), plantillas (`GET /teams`) con nombres en el selector de dorsal, abrir un partido creado en la web. |

## Estructura

```
wear-app/
  core/       Kotlin puro (JVM): dominio portado de core/*.ts, cliente HTTP, vinculación, motor de sincronización
  app/        App Wear OS (Compose Material 3, Room, DataStore, WorkManager)
  contract/   Pruebas de contrato contra la API real (las corre el job "contract" del CI)
  keystore/   Clave de depuración fija y pública (contraseña "android")
```

## Compilar

Necesitas JDK 17 y el SDK de Android (plataforma 36, build-tools 35.0.0).

```bash
cd wear-app
./gradlew assembleDebug testDebugUnitTest     # Windows: gradlew.bat assembleDebug testDebugUnitTest
# APK: app/build/outputs/apk/debug/app-debug.apk
```

`testDebugUnitTest` también corre los tests de `core` (dominio, cliente, vinculación y sincronización).

Pruebas de contrato contra la API en local (en otra terminal, en la raíz del repo: `npm ci && npm run dev:api`):

```bash
cd wear-app
CONTRACT_BASE_URL=http://localhost:8787/api/v1 CONTRACT_PASSPHRASE='tu frase' ./gradlew :contract:test
```

### Descargar el APK del CI

Cada push a `claude/reloj-wear` compila el APK: GitHub → **Actions** → workflow **Wear app** → la última ejecución en
verde → sección **Artifacts** → `arbitraje-reloj-debug-apk` (un `.zip` con `app-debug.apk` dentro; descomprímelo).
Todas las versiones de depuración están firmadas con la misma clave (`keystore/`), así que cada APK se instala encima del
anterior **sin perder** la vinculación ni los partidos.

## Instalar en el Galaxy Watch 4 (paso a paso)

Necesitas `adb` en el ordenador ([Android SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools))
y que el reloj y el ordenador estén en **la misma Wi‑Fi**. Los nombres de menú pueden variar un poco según la versión de
One UI Watch (**por verificar**).

1. **Activar las Opciones de desarrollador:** en el reloj, **Ajustes → Información del reloj → Software** y toca
   **Versión de software** 5 veces, hasta que diga que el modo desarrollador está activado.
2. **Activar la depuración:** **Ajustes → Opciones de desarrollador** → activa **Depuración ADB** y después
   **Depuración inalámbrica** (o «Depurar por Wi‑Fi»). Acepta el aviso.
3. **Emparejar el ordenador (solo la primera vez):** dentro de **Depuración inalámbrica**, toca
   **Emparejar nuevo dispositivo**. El reloj muestra una IP, un puerto y un código de 6 cifras. En el ordenador:
   ```bash
   adb pair 192.168.1.50:37123        # la IP:PUERTO de la pantalla de emparejar
   # escribe el código de 6 cifras cuando lo pida
   ```
4. **Conectar:** vuelve a la pantalla de **Depuración inalámbrica**; ahí aparece otra IP:PUERTO (distinta de la de
   emparejar). En el ordenador:
   ```bash
   adb connect 192.168.1.50:41234     # la IP:PUERTO de la pantalla principal de Depuración inalámbrica
   adb devices                        # debe listar el reloj como "device"
   ```
5. **Instalar** (el APK sacado del artefacto del CI):
   ```bash
   adb install -r app-debug.apk
   adb shell am start -n app.arbitrajeremoto.reloj/.ui.MainActivity
   ```
6. Para ver qué pasa: `adb logcat --pid=$(adb shell pidof app.arbitrajeremoto.reloj)`.
   La app nunca escribe la `deviceKey` en el log.

Desactiva la **Depuración inalámbrica** cuando termines: gasta batería.

### Probar contra una API local (solo debug)

La versión de depuración acepta `http`. Con la API corriendo en el ordenador (`npm run dev:api`):

```bash
adb reverse tcp:8787 tcp:8787     # el localhost:8787 del reloj va al del ordenador
```

y en el reloj: **Ajustes → Local (adb reverse)**. Cualquier otra URL, sin teclear en el reloj:

```bash
adb shell am start -n app.arbitrajeremoto.reloj/.ui.MainActivity --es server_url https://tu-proyecto.vercel.app/api/v1
```

Cambiar de servidor pide vincular otra vez (la clave es de cada servidor); no se borra nada más.

## Internet en la cancha

La app **no necesita red para registrar**: todo se guarda en el reloj y se envía después. Para enviar, el reloj sale a
internet por donde Wear OS decida, sin hacer nada en la app ([acceso a la red en Wear OS](https://developer.android.com/training/wearables/data/network-access)):

| Lo que llevas | Cómo tiene internet el reloj |
|---|---|
| El teléfono Android con el que está configurado el reloj | Por **Bluetooth**, a través del teléfono (automático) |
| Una Wi‑Fi conocida | Por **Wi‑Fi** (Ajustes del reloj → Conexiones → Wi‑Fi) |
| Solo el iPhone | Activa **Compartir Internet** en el iPhone y conecta el reloj a esa Wi‑Fi desde Ajustes → Conexiones → Wi‑Fi |
| Nada | Se registra igual; el punto del marcador queda **gris** y se envía al volver la red |

Recuerda (guía §2): el Galaxy Watch 4 solo se configura con un teléfono Android; no se puede vincular a un iPhone por
Bluetooth, solo usar su Wi‑Fi compartida. **Por verificar** con tu reloj.

## Decisiones técnicas

- **HTTP con `HttpURLConnection`** y **JSON con kotlinx.serialization 1.7.3**: `HttpURLConnection` viene con Android y
  con la JVM, así que el mismo cliente corre en el reloj, en los tests y en las pruebas de contrato, sin librerías extra.
  kotlinx.serialization (plugin 2.1.0, igual que Kotlin) da modelos tipados que también funcionan en la JVM (`org.json`
  en tests locales de Android son stubs vacíos). Tiempo límite: 15 s.
- **WorkManager 2.10.0**: la versión estable que todavía depende de Room 2.6.1 (la 2.11 pasa a Room 2.7 y subiría la
  nuestra) y es compatible con compileSdk 36 / Kotlin 2.1. Los reintentos (5 s → 5 min, o `Retry-After`) se programan como
  retraso inicial de un trabajo único con restricción `CONNECTED`, porque el backoff propio de WorkManager no baja de 10 s.
- **Pantalla encendida en vez de Ongoing Activity**: mientras el partido está en juego, la pantalla del partido pide
  `keepScreenOn`. Es lo más simple y fiable: no necesita servicio en primer plano, notificación ni la librería
  `wear-ongoing` (no estaba en la lista de versiones aprobadas). El cronómetro nunca depende de ello: siempre se
  recalcula con los eventos, así que si la pantalla se apaga no se pierde nada. Coste: batería (**por verificar**).
- **Clave**: AES‑256/GCM con una clave del Android Keystore; el resultado va en DataStore (`reloj_prefs`), excluido de
  copias de seguridad y transferencias (`data_extraction_rules.xml`, `backup_rules.xml`). Sin `EncryptedSharedPreferences`.
- **Dorsal con teclado numérico** en pantalla (1–9, ⌫, 0, ✓), ajustado al cuadrado que cabe en la pantalla redonda: del 1
  al 999 (en futsal hay dorsales como el 108), siempre se confirma con ✓; ✓ sin cifras es «Sin dorsal». Con plantilla, debajo del número
  aparece el nombre del jugador. (Antes era una lista con la corona: se cambió porque buscar el número era lento.)
- **Sin Firebase ni servicios de terceros.** La única red es la API de este repositorio.
