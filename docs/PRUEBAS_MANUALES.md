# Pruebas manuales

Lo que no puedo probar yo (tu cuenta de Netlify, tu iPhone, tu PC, el reloj). Marca cada casilla y dime qué falla.

## Bloque 1 — API

Requisito: sitio desplegado según `docs/DESPLIEGUE.md`. Sustituye `<sitio>` por tu dominio.

### En el iPhone (Safari)

- [ ] Abrir `https://<sitio>.netlify.app/` → se ve "ArbitrajeRemoto" y "La web nueva está en construcción".
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
