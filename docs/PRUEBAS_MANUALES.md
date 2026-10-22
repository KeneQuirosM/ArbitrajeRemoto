# Pruebas manuales

Lo que no puedo probar yo (tu cuenta de Netlify, tu iPhone, tu PC, el reloj). Marca cada casilla y dime qué falla.

## Bloque 1 — API

Requisito: sitio desplegado según `docs/DESPLIEGUE.md`. Sustituye `<sitio>` por tu dominio.

### En el iPhone (Safari)

- [ ] Abrir `https://<sitio>.netlify.app/api/v1/health` → texto con `"ok":true` y la hora del servidor.
- [ ] Abrir `https://<sitio>.netlify.app/api/v1/matches` → `{"error":{"code":"UNAUTHORIZED",...}}` (sin sesión no se ve nada).
- [ ] Abrir `http://<sitio>.netlify.app/api/v1/health` (con **http**) → Safari termina en **https** (redirección).
- [ ] Tu web antigua `https://singular-madeleine-7f0bc5.netlify.app/` sigue funcionando igual que antes.

### En el PC (terminal, con Node 22 y jq instalados)

- [ ] `BASE=https://<sitio>.netlify.app/api/v1 PASSPHRASE='tu frase' bash examples/curl.sh` termina con
      `✓ All examples behaved as documented.`
- [ ] La misma orden con una frase incorrecta se detiene en el paso 1 con `401`.
- [ ] Repite la frase incorrecta 6 veces seguidas → la sexta responde `429` (espera 15 min o cambia de red para volver a entrar).
- [ ] `BASE=... PASSPHRASE='...' npm run seed` muestra la tabla con 3 partidos (`finished 2-1`, `live 1-1`, `scheduled 0-0`).
- [ ] Ejecutar el seed una segunda vez no crea partidos repetidos.
- [ ] En Netlify → **Logs → Functions → api**: no hay errores rojos tras las pruebas.
- [ ] En Netlify → **Usage**: anota cuántos créditos se gastaron con estas pruebas y dímelo.

### Por verificar (dependen de tu cuenta)

- [ ] El plan Free no pide tarjeta para Functions y Blobs.
- [ ] Netlify Blobs funciona sin configuración extra en el sitio nuevo (el seed lo demuestra).
- [ ] La función se despliega con Node 22 (si los logs muestran otro error de versión, avísame).

## Bloque 2 — Web nueva y modo sin conexión

Requisito: el despliegue de `main` con el Bloque 2. Usa Safari en el iPhone salvo que se diga otra cosa.

### Instalar y primera sesión (iPhone)

- [ ] Abrir `https://<sitio>.netlify.app/` → aparece "Partidos" con los botones "Partido rápido" y "Nuevo partido".
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
10. [ ] En el PC, abre `https://<sitio>.netlify.app/`, inicia sesión y abre el partido: aparecen **una sola vez** el gol, la amarilla, el cambio y la nota, con el mismo marcador 1–0.
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
