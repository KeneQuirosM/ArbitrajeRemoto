# ArbitrajeRemoto

Registro de partidos para árbitros de fútbol: web (PWA, funciona sin conexión) + API, pensada para que la app
**ArbitrajeRemoto Reloj** (Wear OS, Galaxy Watch 4) registre el partido y sincronice después.

## Estado

| Bloque | Contenido | Estado |
|---|---|---|
| 1 | API v1 + tests + `docs/API.md` + `openapi.yaml` + ejemplos `curl` + datos de prueba | ✅ |
| 2 | Web nueva: partidos, plantillas, marcador en vivo, deshacer, modo sin conexión | pendiente |
| 3 | Sincronización, vista en vivo, informe/PDF, vinculación del reloj, `docs/GUIA_RELOJ.md` | pendiente |

## Stack

- **Netlify** (plan gratuito): sitio estático + Functions (Node 22, TypeScript) + Blobs (almacenamiento).
- **TypeScript** en todo; `core/` es lógica pura compartida por la web y la API.
- **Vitest** para tests; **GitHub Actions** como CI.

```
core/                 dominio puro: tipos, validación, cronómetro, derivación del estado
server/               API v1 sin framework (Request → Response), almacenamiento, autenticación
netlify/functions/    punto de entrada de la función /api/v1/*
scripts/              servidor local, hash de la frase, datos de prueba
examples/curl.sh      colección de ejemplos ejecutable
docs/                 API.md, CRONOMETRO.md, DESPLIEGUE.md, PRUEBAS_MANUALES.md
openapi.yaml          contrato formal de la API
site/                 página provisional (la PWA llega en el bloque 2)
```

## Desarrollo local

```bash
npm ci
npm test                      # tests unitarios y de API
npm run typecheck

cp .env.example .env          # y rellena con:
npm run hash-passphrase       #   → ADMIN_PASSPHRASE_HASH (entre comillas simples en .env)
npm run gen-secret            #   → SESSION_SECRET
npm run dev:api               # API en http://localhost:8787/api/v1 (datos en .data/)

PASSPHRASE='tu frase' npm run smoke   # ejecuta examples/curl.sh
PASSPHRASE='tu frase' npm run seed    # datos de ejemplo
```

Despliegue: [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md). Contrato: [docs/API.md](docs/API.md) y [openapi.yaml](openapi.yaml).
