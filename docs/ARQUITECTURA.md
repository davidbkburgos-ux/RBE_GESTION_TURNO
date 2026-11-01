# Arquitectura

Scripts clásicos bajo el espacio de nombres global `BK`; sin compilación. `src/game/main.js` crea el objeto `BK.game` (`G`), instancia los sistemas y ejecuta el bucle. Los sistemas se comunican por el bus (`BK.bus.on/emit`) y por referencias a `G`.

| Sistema | Archivo | Responsabilidad |
|---|---|---|
| GameClock | systems/GameClock.js | Reloj acelerado (`day.timeScale`), fases, `clock:end` a la 01:00 |
| NavigationSystem | systems/NavigationSystem.js | Rejilla de 4 px desde `map.json`, A*, puertas, perfiles `staff`/`guest` |
| PlayerController | systems/PlayerController.js | Mover, atender evento, ir a tarea, animaciones |
| CharacterAnimationSystem | systems/CharacterAnimationSystem.js | Sprites procedurales de 8 orientaciones y acciones |
| EventDirector | systems/EventDirector.js | Etapas 1→3, viabilidad por tiempos, saturación y distancia |
| EventSystem | systems/EventSystem.js | Máquina de estados y temporizadores de eventos |
| ScoringSystem | systems/ScoringSystem.js | Puntos, combo, métricas |
| CustomerSystem | systems/CustomerSystem.js | Clientes, mesas, kioscos, repartidores |
| VehicleSystem | systems/VehicleSystem.js | Cola AutoKing: altavoz → ventana 1 → ventana 2 → salida |
| EmployeeSystem | systems/EmployeeSystem.js | Plantilla por dificultad, turnos y puestos; desplazamientos con capacidad temporalmente ocupada |
| ChannelPrioritySystem | systems/ChannelPrioritySystem.js | Panel de prioridad de canal, orden de producción y enfriamiento |
| OpeningRoutineSystem | systems/OpeningRoutineSystem.js | Cinco tareas de checklist hasta las 11:15, puerta y penalización por retraso |
| ProductionSystem | systems/ProductionSystem.js | Tickets por canal, fases de producción, stock, bloqueos y KPI |
| ArrivalDirector | systems/ArrivalDirector.js | Llegadas por canal, perfil de demanda y semilla reproducible |
| BottleneckDetector | systems/BottleneckDetector.js | Alertas de cobertura, stock, pedidos bloqueados, colas y mesas |
| OperationalIncidentSystem | systems/OperationalIncidentSystem.js | Ausencias, timeline y eventos de queja |
| LightingSystem | systems/LightingSystem.js | Ciclo día/noche y luces locales |
| InteractionSystem | systems/InteractionSystem.js | Puntos de interacción de apertura |
| AudioSystem | systems/AudioSystem.js | Sonidos WebAudio sintetizados + subtítulos visuales |
| SaveSystem | systems/SaveSystem.js | localStorage |
| UIManager | ui/UIManager.js | HUD, bocadillos, modales, tutorial |
| KnowledgeQuestionLoader | systems/KnowledgeQuestionLoader.js | Preguntas barajadas con trazabilidad interna de fuente |
| Renderer | game/Renderer.js | Canvas, cámara, indicadores |

## Datos (`src/data/`)
`config.json` (reloj, puntuación, perfiles de dificultad, puestos, demanda, stock y KPI), `map.json` (zonas, obstáculos y puntos), `events.json` (tipos y canales), `questions.json`, `opening.json` (checklist y apertura).
`bundle.js` lo genera `tools/build_data.py`.

## Estados de cliente, mesas y reseñas
`CustomerSystem` expone `stateOf(g)` (BEING_SERVED, WAITING_FOR_ORDER, ORDER_READY, SEATED, NEEDS_HELP, WAIT_FOR_TABLE, TABLE_COMPLAINT, LEAVING) y el renderizador dibuja su icono sobre el cliente.
- Reservas: `busy` reserva destinos de cola/mesa; `sweepReservations` (cada 2 s) libera las huérfanas.
- Atascos: `checkStall` detecta falta de progreso (`operations.navigation`) y `recoverNavigation` recoloca al NPC; tras `maxRecoveries` se retira sin penalizar al jugador (`dropSilently`).
- Mesas: `tableAt`/`attendTable` permiten limpiar una mesa sucia pulsándola, con barra «LIMPIANDO». El evento `dirtyTable` solo se crea si la sala está bloqueada (`hallBlocked`: no hay mesa limpia o las sucias ≥ `operations.tableWait.eventDirtyRatio`).
- Espera de mesa: WAIT_FOR_TABLE → TABLE_COMPLAINT (25 s) → abandono `NO_TABLE` (50 s). Cada abandono genera una reseña de 1★ (`postReview`) sin puntuación adicional.
- Baños: son únicamente un evento de limpieza (`restroom`) que aparece por uso acumulado (`operations.restroom`).
- Exteriores: solo revisión inicial (tarea de apertura) y recorrido CSL.

## Sistema de tiempos (`ServiceKpiSystem`)
Cada servicio completado o abandonado genera un `serviceRecord` normalizado (`simSec`, canal, banda GREEN/YELLOW/RED/ABANDONED).
- Tiempo medido = tiempo real × `factor` del canal; solo sirve para clasificar el resultado (GREEN/YELLOW/RED). Lo que se registra es el valor normalizado del tramo (`normalizedSeconds`: 210/300/420/540 en Mostrador y AutoKing; 30/45/60/90 en Delivery), con `outcome`, `abandoned`, `negativeReview` y `reason`.
- Cubos: Mostrador (incluye kiosco y sala), AutoKing y Delivery (tiempo de entrega). Cada uno tiene su media y su último valor.
- AutoKing en dos pasos (pedido y recogida): el tiempo total es la media de las dos barras de progreso.
- Un abandono cuenta como el tiempo `abandoned` del canal, sin doble penalización.
- Puntuación de fin de día (`endOfDayScore`): puntos por banda de la media de cada canal (`green` 40, `yellow` 15, `red` −30), separada de los puntos por evento y mostrada en el resumen final.
- Los factores, objetivos y bandas son provisionales y están en `config.json`.

## Panel «Operación»
`ui/PhonePanel.js` genera una interfaz de móvil (cabecera, cuerpo con scroll y barra inferior de pestañas). Las etiquetas de puesto de los empleados solo se dibujan con el panel abierto.

El panel de operación muestra tiempos didácticos de atención y AutoKing; no los presenta como una definición oficial del indicador SOS. Las preguntas conservan su fuente en los datos, pero los nombres de documentos no se muestran durante la partida.
