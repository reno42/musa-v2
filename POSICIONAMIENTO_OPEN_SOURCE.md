# 📊 Posicionamiento Open Source — Futuraria Design

**Fecha:** 2026-05-30 | **Visión:** Liquid, open source, proof of product-building capability

---

## 🗺️ Diagrama de Posicionamiento

```
                AGENTES/IA NATIVO ↑
                                   |
          Paper.design ●           |     ● Futuraria Design (NOSOTROS)
          (HTML/CSS, MCP)          |     (Fabric.js, MCP, $0 render)
                                   |
                                   |
  ── PAGO ─────────────────────────────── OPEN SOURCE / FREEMIUM ──→
                                   |
     Figma ●                       |     ● Penpot
     (WebGL, REST, $15+/mes)       |     (SVG, self-hosted, community)
                                   |
     Canva ●                       |
     (Templates, $13+/mes)         |
                                   |
                TEMPLATES/CONSUMER ↓
```

---

## 🎯 Nuestro ángulo único

| Competidor | Tiene MCP | Render API | $0 real | Open source |
|------------|:---:|:---:|:---:|:---:|
| **Figma** | ❌ | ❌ | ❌ ($15/mes) | ❌ |
| **Canva** | ❌ | ❌ | ❌ ($13/mes) | ❌ |
| **Penpot** | ❌ | ❌ | ✅ | ✅ |
| **Paper** | ✅ | ❌ | ❌ | ❌ |
| **Nosotros** | ✅ | ✅ | ✅ | ✅ |

**Somos el único diseño MCP-first + render automático + open source + $0.**

---

## 🚀 Estrategia de lanzamiento open source

### 1. Narrativa
> "El primer editor de diseño web con agentes de IA integrados vía MCP. Creá templates por código, editalos visualmente, exportá PNGs automáticamente. Todo a $0. Todo open source."

### 2. Audiencia objetivo
- **Developers que hacen diseño** — el público de Penpot pero con IA
- **Agencias y freelancers** — necesitan generar posts en batch
- **Startups** — necesitan MVPs visuales rápido
- **AI engineers** — quieren conectar sus agentes a un canvas de diseño

### 3. Canales de difusión
| Canal | Mensaje | Formato |
|-------|---------|---------|
| **GitHub** | README con demo GIF + MCP quickstart | Repo público + MIT license |
| **Hacker News** | "Show HN: Futuraria Design — open source Figma alternative with MCP agents" | Post |
| **Twitter/X** | Thread mostrando el pipeline: MCP → Editor → PNG en 3s | Carrusel de screenshots |
| **Product Hunt** | Launch con video demo de 60s | Listing |
| **dev.to / Hashnode** | Tutorial: "How to build a social media post generator with MCP" | Artículo técnico |
| **Discord community** | Canal para early adopters y contribuidores | Server |

### 4. Lo que regalamos (freemium strategy)
- **Core:** Editor + MCP + Render → open source (MIT)
- **Premium futuro:** Batch render (+50 PNGs), templates premium, analytics, white-label
- **Enterprise:** Self-hosted con soporte, SSO, audit logs

---

## 🔴 Riesgos y problemas potenciales

### Legales
| Riesgo | Mitigación |
|--------|------------|
| **Licencia MIT mal aplicada** | Incluir LICENSE clara, copyright "Renzo Perez Bartra / Futuraria" |
| **Dependencias con licencias restrictivas** | Auditar `npm list --depth=5` antes de publicar. Fabric.js es MIT ✅. Google Fonts API es gratis ✅. |
| **Uso de la marca "Futuraria" en forks** | La licencia MIT permite forks pero no uso de trademark. Registrar marca en Perú (INDECOPI) |
| **GDPR / datos de usuarios** | Si alguien self-hospea, ellos manejan sus datos. Nosotros no almacenamos nada del usuario final |

### Técnicos
| Riesgo | Mitigación |
|--------|------------|
| **Issues y PRs nos desbordan** | CONTRIBUTING.md con reglas claras. GitHub Actions para CI. Labels: "good first issue" |
| **El MCP se rompe con updates de Netlify** | Pinned versions en package.json. Tests de integración |
| **Supabase free tier se llena** | Limpiar templates viejos automáticamente (TTL de 30 días en la demo pública) |
| **Alguien fork y compite** | La marca "Futuraria" no se puede forkear. El producto sí — pero la comunidad se queda con el original si damos soporte |

### Comunidad
| Riesgo | Mitigación |
|--------|------------|
| **Trolls / spam en issues** | GitHub Actions + CODEOWNERS |
| **Feature creep** | Roadmap público. Decir "no" con amabilidad. "Great idea! We'll add it to the backlog." |
| **Burnout de maintainer** | Esto es una vitrina de capacidad, no un SaaS. Si crece, contratamos. Si no, queda como portafolio. |

### Reputacionales
| Riesgo | Mitigación |
|--------|------------|
| **Bugs en producción** | La demo pública es justamente eso: demo. Dejar claro en el README que es alpha |
| **"Esto ya existe"** | Sí, pero no con MCP + render a $0. Nuestro ángulo es el agente que diseña solo |

---

## 📈 Cómo milkeamos esto como portafolio personal

1. **GitHub pinned repo** → "Futuraria Design" como prueba de full-stack + AI + producto
2. **Blog post en futuraria.com** → "Cómo construí un Figma con agentes de IA en 3 días"
3. **Thread de Twitter** → El pipeline MCP → Editor → Render con screenshots
4. **Video de demo en 60s** → Para LinkedIn, portfolio, pitch de consultoría
5. **Charla/Taller** → "Diseño programático con MCP" en comunidades tech

---

## 🎯 Plan de acción inmediato

| # | Acción | Responsable |
|---|--------|-------------|
| 1 | Limpiar código (quitar hardcodes, variables de entorno) | Agent IDE |
| 2 | Escribir README.md con quickstart MCP | Lara |
| 3 | Crear LICENSE (MIT) | Ren |
| 4 | Grabar demo de 60s (MCP → Editor → PNG) | Lara + Ren |
| 5 | Hacer repo público en GitHub | Ren |
| 6 | Publicar en Hacker News / Product Hunt | Ren + Lara |

---

## 📂 Este documento en el repo

```
design-main/POSICIONAMIENTO_OPEN_SOURCE.md
```
