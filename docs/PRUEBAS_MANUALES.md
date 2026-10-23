# Pruebas manuales

Lo que no puedo probar yo (tus cuentas de Vercel y Supabase, tu iPhone, tu PC, el reloj). Marca cada casilla y dime qué falla.

## Bloque 1 — API

Requisito: sitio desplegado según `docs/DESPLIEGUE.md`. Sustituye `<proyecto>` por tu subdominio de Vercel.

### En el iPhone (Safari)

- [ ] Abrir `https://<proyecto>.vercel.app/api/v1/health` → texto con `"ok":true` y la hora del servidor.
- [ ] Abrir `https://<proyecto>.vercel.app/api/v1/matches` → `{"error":{"code":"UNAUTHORIZED",...}}` (sin sesión no se ve nada).
- [ ] Abrir `http://<proyecto>.vercel.app/api/v1/health` (con **http**) → Safari termina en **https** (redirección).
- [ ] Tu web antigua `https://singular-madeleine-7f0bc5.netlify.app/` sigue funcionando igual que antes.

### En el PC (terminal, con Node 22 y jq instalados)

- [ ] `BASE=https://<proyecto>.vercel.app/api/v1 PASSPHRASE='tu frase' bash examples/curl.sh` termina con
      `✓ All examples behaved as documented.`
- [ ] La misma orden con una frase incorrecta se detiene en el paso 1 con `401`.
- [ ] Repite la frase incorrecta 6 veces seguidas → la sexta responde `429` (espera 15 min o cambia de red para volver a entrar).
- [ ] `BASE=... PASSPHRASE='...' npm run seed` muestra la tabla con 3 partidos (`finished 2-1`, `live 1-1`, `scheduled 0-0`).
- [ ] Ejecutar el seed una segunda vez no crea partidos repetidos.
- [ ] En Vercel → el proyecto → **Logs**: no hay errores (rojo) tras las pruebas.
- [ ] Anota el consumo en la tabla de `docs/DESPLIEGUE.md` §4 y dímelo.

### Por verificar (dependen de tu cuenta)

- [ ] Ni Vercel Hobby ni Supabase Free piden tarjeta.
- [ ] La función se despliega con Node 22 (Vercel → Deployments → el último → **Functions**).

## Bloque 2 — Web nueva y modo sin conexión

Requisito: el despliegue de `main` en Vercel (Bloque 2.5 incluido). Usa Safari en el iPhone salvo que se diga otra cosa.

### Instalar y primera sesión (iPhone)

- [ ] Abrir `https://<proyecto>.vercel.app/` → aparece "Partidos" con los botones "Partido rápido" y "Nuevo partido".
- [ ] Compartir → **Añadir a pantalla de inicio**. El icono (tarjetas amarilla y roja sobre verde) aparece con el nombre ArbitrajeRemoto.
- [ ] Abrir la app desde el icono: se abre a pantalla completa, sin barra de Safari.
- [ ] Ajustes → escribir la frase de acceso → "Iniciar sesión" → aparece "Sesión iniciada". La etiqueta de arriba pasa a "Sincronizado".
- [ ] Frase incorrecta → mensaje "Frase incorrecta." (sin cerrar nada).

### Partido rápido sin plantilla ni conexión (iPhone) — la prueba clave

1. [ ] Con la app abierta y la sesión iniciada, activa el **modo avión** (sin Wi‑Fi).
2. [ ] Cierra la app del todo (deslizar hacia arriba) y vuelve a abrirla desde el icono → abre igual, sin conexión.
3. [ ] "Partido rápido" → se abre el marcador **Local 0 – 0 Visitante**. La etiqueta dice "Sin conexión. 1 pendiente".
4. [ ] "Iniciar 1.er tiempo" → el cronómetro corre en amarillo.
5. [ ] Gol de Local con el 9, amarilla a Visitante con el 4, cambio de Visitante (sale 4, entra 14) y una nota.
       Cada evento aparece en "Eventos" con "pendiente de enviar".
6. [ ] Bloquea el teléfono 2 minutos y desbloquéalo → el cronómetro muestra el tiempo correcto (no se ha parado ni reiniciado).
7. [ ] "Pausar" 30 s y "Reanudar" → el cronómetro no cuenta esos 30 s.
8. [ ] Desactiva el modo avión y vuelve a la app → en pocos segundos la etiqueta pasa a "Sincronizado" y desaparecen los "pendiente de enviar".
9. [ ] Ajustes → "Sincronizar ahora" **tres veces**.
10. [ ] En el PC, abre `https://<proyecto>.vercel.app/`, inicia sesión y abre el partido: aparecen **una sola vez** el gol, la amarilla, el cambio y la nota, con el mismo marcador 1–0.
       (Comprobación técnica opcional: `GET /api/v1/matches/{id}?include=events` devuelve 5 eventos: inicio, gol, amarilla, cambio y nota).

### Marcador (iPhone)

- [ ] Sin hacer scroll se ven el marcador, el cronómetro, el botón principal (Iniciar/Pausar) y los botones "Gol" de ambos equipos.
- [ ] Todos los botones se pulsan con facilidad con el pulgar (también con guantes finos, si los usas).
- [ ] "Deshacer" pregunta qué evento se va a deshacer; al confirmar, el marcador se corrige.
- [ ] Dos amarillas al mismo dorsal → en "Eventos" la segunda dice "(segunda amarilla)".
- [ ] "Tiempo añadido" → elegir +3 → aparece "Añadido anunciado: +3".
- [ ] Al pasar de 45:00 en el primer tiempo, el minuto se muestra como "45+1".
- [ ] "Fin del 1.er tiempo" → "Descanso"; "Iniciar 2.º tiempo" → el minuto empieza en 46.
- [ ] "Reiniciar" pide confirmación y deja el partido en 0–0 sin empezar.
- [ ] Al sol: el marcador y el cronómetro se leen bien con el brillo automático.
- [ ] Ajustes de iPhone → Pantalla y brillo → Tamaño del texto al máximo → la app agranda el texto sin que se corte nada importante.
- [ ] Modo oscuro del iPhone → la app cambia a colores oscuros legibles.

### Partidos y equipos (iPhone y PC)

- [ ] Equipos → "Nuevo equipo" → nombre y 3 jugadores (dorsal y nombre) → "Guardar equipo".
- [ ] Dorsal repetido o 100 → mensaje de error claro, no se guarda.
- [ ] "Nuevo partido" con ese equipo como local, fecha y torneo → en el marcador, al pulsar "Gol", aparecen los dorsales del equipo para elegir con un toque.
- [ ] La lista de partidos los separa en "En juego", "Próximos" y "Terminados".
- [ ] "Editar datos" → cambiar el torneo → se guarda. "Borrar partido" pide confirmación.
- [ ] Ajustes → Idioma → English → la app cambia a inglés; volver a Español.

### PC (Chrome, Edge o Safari)

- [ ] El marcador se ve en dos columnas (marcador y cronómetro a la izquierda, botones de equipos a la derecha).
- [ ] Se puede usar entero con teclado (Tab, Intro, Escape cierra los diálogos) y el foco se ve.
- [ ] Chrome/Edge ofrecen "Instalar ArbitrajeRemoto" en la barra de direcciones.

## Bloque 2.5 — Vercel + Supabase

Requisito: pasos 1–3 de `docs/DESPLIEGUE.md` hechos. Repite también todas las pruebas del Bloque 2 en la dirección de Vercel:
son las mismas, solo cambia dónde se guardan los datos.

### Despliegue y base de datos (PC)

- [ ] Supabase → **Table Editor** → esquema `arbitraje`: aparecen 7 tablas, todas con **RLS enabled**.
- [ ] Supabase → **Database → Policies**: el esquema `arbitraje` **no** tiene políticas (es lo correcto: solo entra el servidor).
- [ ] Vercel → **Settings → Functions**: región **iad1** (Washington, D.C.).
- [ ] Vercel → **Settings → Environment Variables**: están `DATABASE_URL`, `ADMIN_PASSPHRASE_HASH`, `SESSION_SECRET` y `CRON_SECRET`.
- [ ] La clave no llega al navegador: en el PC abre la web, pulsa F12 → **Sources/Fuentes**, busca `postgresql` en los
      archivos `.js` → **0 resultados**.
- [ ] `examples/curl.sh` contra Vercel termina con `✓` (comprueba también que `?status=`, `?fields=`, `?since=` y `?token=`
      llegan bien a la función).
- [ ] Vercel → **Settings → Cron Jobs** → `/api/cron/keepalive` → **Run** → en **Logs**, respuesta 200 con `"ok":true`.
- [ ] Abrir `https://<proyecto>.vercel.app/api/cron/keepalive` en el navegador → **401** (sin el secreto no se puede llamar).
- [ ] Haz un push a una rama que no sea `main`: en Vercel → **Deployments** aparece como **Canceled** (sin gastar cuota de build).
- [ ] Una semana después: no ha llegado ningún correo de Supabase avisando de pausa por inactividad.

### iPhone: datos en Supabase

1. [ ] Instala la app desde `https://<proyecto>.vercel.app` (Compartir → Añadir a pantalla de inicio) e inicia sesión.
2. [ ] Modo avión → **Partido rápido** → inicia el 1.er tiempo, gol del 9 local y amarilla al 4 visitante.
3. [ ] Quita el modo avión → la etiqueta pasa a "Sincronizado" (si tarda unos 30 s en lugar de unos pocos, dímelo).
4. [ ] Ajustes → "Sincronizar ahora" **tres veces**.
5. [ ] Supabase → **Table Editor → arbitraje → events**: filtra por el `match_id` del partido → hay exactamente **3 filas**
       (inicio, gol, amarilla), con `seq` 1, 2 y 3. Ninguna repetida.
6. [ ] Borra el partido desde la web (Editar datos → Borrar partido) → en `events` ya no hay filas de ese partido, y en
       `matches` la fila sigue con `deleted_at` relleno (así un reenvío del reloj recibe 410 en vez de resucitarlo).
7. [ ] Primera petición del día (con la app cerrada desde ayer): abre la app y mira cuánto tarda en pasar a "Sincronizado".
       Si son más de 5 segundos, dímelo (puede ser el "arranque en frío" de la función).
