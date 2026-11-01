# Turno de Encargado — mock jugable (vertical slice)

Juego de gestión semi-isométrico en HTML5 Canvas + HTML/CSS. Un único encargado recorre el restaurante (plano suministrado), completa la apertura y atiende eventos de mostrador, kiosco, mesas, AutoKing y delivery de 10:00 a 01:00. Sin backend.

La V2 añade perfiles entre semana, fin de semana y festivo especial; planificación de turnos y puestos; checklist de cinco tareas hasta las 11:15; demanda reproducible mediante semilla; producción, inventario y reposición espacial; colas de AutoKing; incidencias y panel de KPI/cuello de botella. Los datos son configurables en `src/data/`. El panel etiqueta los tiempos como indicadores didácticos, no como una definición oficial de SOS.

Actualizaciones posteriores: el AutoKing funciona en dos pasos (pedido y recogida; su tiempo es la media de ambas barras); el panel «Operación» se abre como un móvil y las etiquetas de puesto solo se ven con él abierto; las mesas sucias solo generan evento si la sala queda bloqueada; los clientes sin mesa se quejan y dejan reseña negativa. Detalle y pruebas en `docs/PRUEBAS.md` y límites en `docs/LIMITACIONES.md`.

## Ejecutar
- **Opción 1:** abrir `index.html` (funciona desde `file://` porque los datos van en `src/data/bundle.js`).
- **Opción 2:** servidor local: `py -m http.server 8765` y abrir `http://localhost:8765/index.html`.
- `?debug` en la URL: superpone la malla de navegación (tecla `G` para alternar).

Si editas los JSON de `src/data/`, regenera el bundle: `py tools/build_data.py`.

## Controles
| Acción | Ratón / táctil | Teclado |
|---|---|---|
| Mover | clic / toque en el suelo | WASD o flechas |
| Atender evento | clic / toque en la exclamación o en su ficha | `E` (el más urgente) |
| Responder pregunta / elegir canal | botones | `1`, `2`, `3` |
| Pausa / sonido | botones del HUD | `P` / `M` |
| Zoom | rueda, pellizco, `+`/`−` | |
| Cerrar paneles | ✕ | `Esc` |

## Parámetros
Todo en `src/data/config.json` (reloj, fases, puntuaciones, temporizadores, perfiles de dificultad, puestos, demanda, stock, iluminación y prioridad). Ver `docs/ARQUITECTURA.md`.

## Documentación
`docs/`: ARQUITECTURA, PLANO_ZONAS, RECURSOS_PENDIENTES, CATALOGO_EVENTOS, PREGUNTAS_FUENTES, PRUEBAS, DECISIONES_SUPUESTOS, LIMITACIONES, BACKLOG.
