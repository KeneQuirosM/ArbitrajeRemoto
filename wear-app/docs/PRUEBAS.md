# Pruebas manuales del reloj (por verificar)

Todo lo de esta lista depende del **Galaxy Watch 4 real** (o de tu teléfono y tus cuentas) y no se pudo probar desde el CI.
Marca cada punto cuando lo compruebes. Lo que sí está probado automáticamente: el dominio (mismos casos que
`core/*.test.ts`), el cliente HTTP, la vinculación, la cola y la sincronización (tests unitarios) y el contrato completo
contra la API real (job `contract`).

Instalación: [`../README.md`](../README.md#instalar-en-el-galaxy-watch-4-paso-a-paso).

## Guía §12 (de `docs/GUIA_RELOJ.md`)

- [ ] **1. Vincular:** en el reloj aparece un código («K7M 3QX») con cuenta atrás. En la web, **Ajustes → Relojes**, escríbelo
  en minúsculas y con guion → «Vincular reloj». En unos segundos el reloj dice «Vinculado ✓» y la web lo lista.
- [ ] **2. Código caducado:** pide un código y espera 10 minutos sin aprobarlo. La web dice «El código caducó» y el reloj ofrece
  «Pedir otro código».
- [ ] **3. Partido rápido sin red:** en modo avión (sin teléfono ni Wi‑Fi cerca), «Partido rápido» → «Iniciar 1.º tiempo» → un gol
  y una amarilla. El marcador cambia al momento; el punto es gris.
- [ ] **4. Sincronizar sin duplicados:** devuelve la red (teléfono o Compartir Internet del iPhone). En la web aparece
  «Local – Visitante» 1–0. Sal y entra varias veces de la app: el partido y sus eventos siguen apareciendo una sola vez
  (en la base de datos, `select count(*) from arbitraje.events where match_id = '<id>';` da 3).
- [ ] **5. Vista en vivo:** «Compartir en vivo» en la web y ábrelo en otro teléfono. Un gol en el reloj aparece en < ~20 s.
- [ ] **6. Deshacer desde el reloj:** «Deshacer» muestra «¿Deshacer gol de Local, 9?» → «Deshacer». El marcador vuelve atrás en
  el reloj, en la web y en la vista en vivo.
- [ ] **7. Desvincular:** en la web, **Relojes → Desvincular**. Al registrar algo o reabrir la app, el reloj dice «Reloj
  desvinculado. Vuelve a vincularlo»; tras vincular de nuevo, los eventos pendientes se envían (no se pierde nada).
- [ ] **8. Batería y reposo:** con el cronómetro en marcha, deja que la pantalla se apague 2 minutos (o apágala con la palma). Al
  despertarlo, el tiempo es correcto.
- [ ] **9. Hora del reloj mal puesta:** adelanta la hora del reloj 10 minutos (si el sistema lo permite), registra un gol y
  envíalo. En la web aparece en el minuto correcto (el servidor corrige con `sentAt`).

## R1. Esqueleto y vinculación

- [ ] La app aparece en el lanzador con su icono y abre en tema oscuro; deslizar a la derecha vuelve atrás.
- [ ] Textos en español con el reloj en español, y en inglés con el reloj en inglés.
- [ ] El código se lee bien a un brazo de distancia; la cuenta atrás baja cada segundo.
- [ ] Sin red al pedir el código: «Sin conexión. Reintentando…» y, al volver la red, aparece el código sin tocar nada.
- [ ] Al vincular, `adb logcat` no muestra la `deviceKey` (busca `ark1_`: no debe aparecer).
- [ ] La clave sobrevive a reiniciar el reloj y a `adb install -r` de un APK nuevo (no pide vincular otra vez).
- [ ] **Keystore:** tras vincular, `adb shell run-as app.arbitrajeremoto.reloj ls files/datastore` muestra `reloj_prefs.preferences_pb`
  y su contenido no contiene `ark1_` en claro.
- [ ] **Ajustes → Servidor:** el predeterminado es `https://arbitraje-remoto.vercel.app/api/v1`. En debug, «Local (adb reverse)»
  con `adb reverse tcp:8787 tcp:8787` funciona contra `npm run dev:api`. Cambiar de servidor pide vincular otra vez.
- [ ] La URL por `adb shell am start … --es server_url …` se aplica en debug.
- [ ] TalkBack (Ajustes → Accesibilidad): lee el código letra a letra, los botones con su nombre y cada tecla del teclado de dorsal.

## R2. Partido sin conexión

- [ ] Marcador «Local 0 – 0 Visitante» y el minuto: «1′ · 00:12»; en pausa «Pausa · 10′».
- [ ] Tiempo añadido: pasado el minuto 45 se ve «45+1′», «45+2′»…; «Más → Tiempo añadido → +3» muestra «+3 anunciados».
- [ ] Botón del cronómetro: tocar = Iniciar / Pausar / Reanudar / Iniciar 2.º tiempo. **Mantener pulsado** = «Fin del 1.º tiempo» /
  «Terminar partido». Un toque accidental no termina nada.
- [ ] **Teclado de dorsal**: las teclas se pulsan bien con el dedo y no se cortan en los bordes de la pantalla redonda.
- [ ] «9» → ✓, «10» → ✓ y «108» → ✓ se registran con ese dorsal; no deja escribir una cuarta cifra ni empezar por 0; ✓ sin cifras registra «Sin dorsal»; ⌫ borra.
- [ ] Un gol con el 108 aparece en la web con el 108 (necesita la migración `20261027120000_player_numbers_999.sql` aplicada en Supabase).
- [ ] En un cambio, el dorsal que entra no puede ser el mismo que sale («Es el mismo que sale»).
- [ ] Segunda amarilla del mismo dorsal: aparece en «Expulsados: Visitante 5 (2.ª amarilla)».
- [ ] Autogol y Cambio desde «Más»; el cambio no deja elegir el mismo dorsal para entrar.
- [ ] **Vibración** corta al registrar cada evento (y no al abrir pantallas).
- [ ] La pantalla **no se apaga** mientras el partido está en juego; en descanso o al terminar vuelve a apagarse normal.
- [ ] Dos goles seguidos («Gol» → «9» → ✓, dos veces): dos goles con minutos correctos, ninguno se pierde.
- [ ] Reinicia el reloj a mitad de partido: al abrir la app, el marcador y el minuto son correctos.

## R3. Sincronización

- [ ] Con red: tras cada evento el punto pasa de ámbar a **verde** en pocos segundos.
- [ ] Sin red: el punto está **gris** («Sin red, N pendientes» con TalkBack); al volver la red (sin abrir la app) se envía solo
  (WorkManager) — compruébalo en la web.
- [ ] Red intermitente (entrar y salir del alcance de la Wi‑Fi): ningún evento duplicado en la web.
- [ ] Un partido borrado en la web deja de enviarse y el reloj lo indica («Borrado en la web: ya no se envía»).
- [ ] Debajo del marcador aparece «Servidor: 1 – 0 · 16:40:00» tras enviar (solo informativo).

## R4. Datos del servidor

- [ ] «Partidos del día» lista los partidos programados y en juego de la web, con hora y marcador.
- [ ] Sin red, «Partidos del día» muestra la última lista guardada y «Sin conexión: se muestra la última lista».
- [ ] Abrir un partido creado en la web con plantillas: al teclear «9» aparece debajo «Delantera».
- [ ] Con un partido de la web abierto en el reloj, un gol registrado en la web aparece en el reloj en ~20 s.
- [ ] Eventos registrados en el reloj en un partido de la web aparecen en la web.
