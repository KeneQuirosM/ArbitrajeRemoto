# Despliegue en Netlify (paso a paso)

Este proyecto se publica en un **sitio de Netlify nuevo**. Tu web actual
(`singular-madeleine-7f0bc5.netlify.app`) **no se toca**: siguen siendo dos sitios distintos hasta que tú decidas reemplazarla.

> **Por verificar:** no he podido abrir la documentación oficial de Netlify desde mi entorno. Los nombres de menús
> pueden variar ligeramente; si algo no coincide, dime qué ves y lo ajusto.

## Lo que necesitas

- La cuenta de Netlify que ya usas (plan **Free**), con acceso a GitHub.
- Un ordenador con Node.js 22 o superior **solo** para generar el hash de tu frase (o pídeme que te guíe con otra opción).

## 1. Elige tu frase de acceso y genera su hash

1. Piensa una frase larga que recuerdes, por ejemplo cuatro palabras sueltas con algún número (mínimo 12 caracteres).
   **No me la digas ni la guardes en el repositorio.**
2. En tu PC, dentro de la carpeta del proyecto:
   ```bash
   npm ci
   npm run hash-passphrase
   ```
   Escribe la frase dos veces (no se ve al teclear). Copia la línea que empieza por `scrypt$...`: es `ADMIN_PASSPHRASE_HASH`.
3. Genera el secreto de sesión:
   ```bash
   npm run gen-secret
   ```
   Copia el resultado: es `SESSION_SECRET`.

## 2. Crea el sitio nuevo

1. Entra en https://app.netlify.com → **Add new site** (o *Add new project*) → **Import an existing project**.
2. Elige **GitHub** y el repositorio **ArbitrajeRemoto**.
3. Rama a desplegar: `main` (cuando fusionemos esta rama). Netlify leerá `netlify.toml`: no cambies *Build command* ni *Publish directory*.
4. Antes de desplegar (o justo después), en **Site configuration → Environment variables → Add a variable**, crea:
   - `ADMIN_PASSPHRASE_HASH` = la línea `scrypt$...` (pégala tal cual, sin comillas).
   - `SESSION_SECRET` = el secreto generado.
   Si te deja marcar la variable como **secreta**, márcala. Ámbito: todas las funciones/contextos.
5. **Ahorra créditos** (el plan gratuito tiene un tope mensual; ver §4):
   - **Site configuration → Build & deploy → Continuous deployment → Branches and deploy contexts:** despliega solo la rama de producción y
     **desactiva Deploy Previews** y *branch deploys*.
6. Cambia el nombre del sitio (**Site configuration → Change site name**) a `arbitrajeremoto` si está libre. La URL será
   `https://arbitrajeremoto.netlify.app`.
7. Lanza el despliegue (**Deploys → Trigger deploy**).

## 3. Comprueba que funciona

Desde cualquier navegador:

- `https://<tu-sitio>.netlify.app/api/v1/health` → debe mostrar `{"ok":true,...}`.

Desde tu PC (opcional, crea datos de prueba y los borra al final):

```bash
BASE=https://<tu-sitio>.netlify.app/api/v1 PASSPHRASE='tu frase' bash examples/curl.sh
BASE=https://<tu-sitio>.netlify.app/api/v1 PASSPHRASE='tu frase' npm run seed   # datos de ejemplo que se quedan
```

Si `/session` responde `SERVER_MISCONFIGURED`, falta una variable de entorno o está mal copiada: corrígela y vuelve a desplegar.

## 4. Plan gratuito: qué puede pasar

Según fuentes secundarias de 2026 (**por verificar** en la documentación oficial):

- El plan Free da **300 créditos al mes** con **tope duro**: si se agotan, Netlify **pausa todos tus sitios** hasta el mes siguiente.
  No hay cobros sorpresa ni tarjeta.
- Consumen créditos: cada **despliegue de producción**, el ancho de banda, las peticiones y el cómputo de las funciones.
- Lo que hace el proyecto para gastar poco:
  - Los tests corren en **GitHub Actions** (gratis en repos públicos; en privados hay minutos gratis mensuales), no en Netlify.
  - Solo se despliega `main`; sin previews.
  - Respuestas pequeñas; la vista en vivo usa `ETag`/`304`, consulta cada 10 s y para cuando el partido acaba o la pestaña no se ve.
- Revisa el consumo en **Team → Usage / Billing** la primera semana y dime las cifras.

## 5. Cambiar la frase o cerrar todas las sesiones

- Nueva frase: repite §1.2 y reemplaza `ADMIN_PASSPHRASE_HASH`; vuelve a desplegar.
- Cerrar sesión en todos los dispositivos: reemplaza `SESSION_SECRET` y vuelve a desplegar.
- Relojes: se revocan uno a uno desde la web (o con `DELETE /api/v1/devices/{keyId}`).
