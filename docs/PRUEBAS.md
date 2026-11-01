# Pruebas realizadas (V1)

Entorno: Chromium integrado (escritorio), servidor `py -m http.server`. Resultado: **sin errores en consola** en todas las ejecuciones.

| Prueba | Resultado |
|---|---|
| Arranque, menú y tutorial | OK |
| Ruta a punto de revisión de cocina, sala, baños y puerta (A*) | OK; el avatar llega a los puntos |
| Pregunta de revisión: correcta +100 / incorrecta −50 | OK (50 tras una de cada) |
| Apertura antes de las 12:00 | OK: +300, "abierto a tiempo" |
| Evento mostrador, vehículo (excelente) | OK: +100 cada uno, combo x1.1 |
| Evento expirado | OK: mostrador, vehículo y mesa fallidos con cara roja |
| Fin de turno 01:00 y resumen, mejor puntuación guardada | OK |
| Mesa sucia, kiosco, pedido listo, delivery, vehículo simultáneos | OK: 4 eventos activos, fichas e indicadores visibles |
| Panel de prioridad y elección de AutoKing | OK: HUD muestra "AutoKing · 31s" |
| Cambio de iluminación y reloj | OK (verificado en capturas) |

**Pendiente de verificación manual:** retraso de 10/20/30 min (lógica implementada: −100 por bloque), toque en móvil real, redimensionado, recarga de partida, modo sin sonido y movimiento reducido (implementados, sin captura documentada), prioridad de Mostrador y Delivery.

## Verificación V2 de esta iteración

| Prueba | Resultado |
|---|---|
| Regeneración del bundle con `py tools/build_data.py` | OK |
| Parseo de los cinco JSON de datos | OK |
| Arranque Chromium, menú, posicionamiento e inicio de partida | OK; sin errores `pageerror` |
| Selección de dificultad antes del posicionamiento | OK; fin de semana muestra 12 personas (7 comida/merienda, 5 cena) |
| Panel de operación en comida | OK; cobertura por puesto, cuellos de botella y stock inicial visibles |
| Indicador de checklist | OK; muestra 0/5 y excluye la apertura de puerta |
| Navegación a preparación de producto | OK; llegó al punto y abrió su pregunta |
| Rutas de los cinco puntos de checklist y de apertura | OK; también exterior (pavimento oeste), montaje y reposición son alcanzables desde el inicio |
| Smoke de producción (pedido, stock agotado y reposición) | OK en Chromium mediante invocación controlada del sistema; la interacción espacial completa sigue pendiente |

**Pendiente de verificación V2:** completar el checklist antes de 11:15 y abrir a las 12:00; cambios de turno a las 18:00; pipeline de llegadas y producción con reposición espacial end-to-end; cola física y KPI de AutoKing; ausencias y quejas; resumen al cierre a la 01:00. No se considera validado el día completo hasta ejecutar estas pruebas.

## Verificación V3 de demanda y operación

Entorno: Chromium integrado, `http://127.0.0.1:8765/index.html?debugSimulation=true`.

| Prueba | Resultado |
|---|---|
| Regeneración del bundle después de añadir configuración de riesgo de apertura | OK |
| `deterministicSimulationTest`, 12:00–13:00, semilla fija | OK en weekday, weekend y specialHoliday; el director creó al menos un evento en los tres perfiles |
| Llegadas por canal (mostrador, kiosco, AutoKing, delivery y sala) | weekday: 2/1/1/1/1 (6); weekend: 3/1/2/1/1 (8); specialHoliday: 4/2/3/1/1 (11) |
| Actividad ambiental registrada | OK: cliente entra, pide, se sienta y sale; rider entra y sale; coche llega y forma cola; se genera mesa sucia |
| Smoke de eventos operativos | OK: mostrador, kiosco, delivery, mesa sucia, falta de producto, queja y recogida AutoKing. Para el smoke aislado de AutoKing se preparó el producto; el test determinista también produjo una recogida mediante el flujo simulado |
| Pregunta contextual en exterior, cocina y sala | OK: cada pregunta devuelta incluye la zona solicitada |
| Encargado cubre y abandona Fritos | OK: capacidad cambia de 1 a 2 y vuelve a 1; movimiento finaliza en `WORKING_POSITION` |
| Apertura incompleta | OK: solicita confirmación, permite abrir de todos modos, aplica el riesgo configurado (12 %) por producto no preparado y no vuelve a penalizar al calcular de nuevo |
| Transición a cierre | OK: a las 00:00 cambia a `CLOSING`; ArrivalDirector y EventDirector siguen activos |
| Drawer de Operación en emulación móvil (390 × 844) | OK: bottom sheet de hasta 55 %; la parte superior del mapa permanece visible y el aviso de orientación queda detrás del panel |
| Arranque Chromium después de regenerar datos | OK; aplicación y panel de diagnóstico cargan |

**Pendiente de verificación V3:** resolución interactiva de cada tipo de evento de extremo a extremo; salida de un vehículo hasta `VEHICLE_EXIT`; watchdog en un escenario de parada real; persistencia y ajuste de audio; drawer en móvil real; turno completo hasta 01:00 y resumen final. No se marca como validado el turno completo.

## V4 · Autonomía, impaciencia, baños y CSL
Ejecutado en Chromium (simulación con jugador pasivo, weekend, semilla 1234, 12:00–20:24): sin errores de consola; 21 abandonos (clientes/coches), 23 incidencias resueltas por el equipo, 1 incidencia de baños, CSL activado a las 16:00 y cerrado a las 17:15 con tareas omitidas penalizadas. Test determinista OK en weekday/weekend/specialHoliday.
No validado: móvil físico, audio real, turno completo hasta 01:00, CSL respondido por el jugador.
Laguna documental: no hay procedimiento específico de CSL para baños ni exteriores; las preguntas se apoyan en rutinas generales.

## V5 · UX: estados, mesas, reseñas, CSL repetible, AutoKing en 2 pasos
Ejecutado en Chromium, sin errores de consola:
- AutoKing en 2 pasos: coche con pedido 19,6 s, recogida 29,4 s, servicio medio 24,5 s.
- Kioscos: 3 de 3 clientes llegan a la zona de pedido.
- Todas las mesas sucias durante 400 s de simulación: aparecen WAIT_FOR_TABLE y TABLE_COMPLAINT (3 quejas), abandono NO_TABLE con reseña 1★ (reseñas = abandonos, sin doble penalización).
- CSL/checklist: fallo (-50) → FAILED con «REPETIR» → nueva pregunta → acierto = PASSED sin nueva puntuación; snapshot/restore conserva FAILED.
- Día completo con jugador pasivo hasta el resumen: muestra puntuación de eventos y KPI de fin de día por separado.
- Test de fugas (3 ciclos): limpio, 82 listeners estables.
No validado: clic real sobre mesa sucia con el ratón, móvil físico, NAVIGATION_RECOVERY con atascos reales.

### V5.1 · Etiquetas de puesto y mesas sin evento
Chromium, sin errores de consola:
- Etiquetas de puesto de los empleados: 0 con el panel «Operación» cerrado, 6 al abrirlo.
- Una sola mesa sucia con mesas limpias disponibles: 30 s de simulación sin evento de mesa sucia.
- Clic real con el ratón sobre la mesa sucia: el encargado camina, limpia (6,4 s) y la mesa queda limpia (+75, mesas limpiadas = 1).
- Con todas las mesas sucias (sala bloqueada) sí se genera el evento. Regla: evento solo si no hay mesa limpia o las sucias son ≥ 60 % (`operations.tableWait.eventDirtyRatio`).
- Nota: el botón de depuración «Mesa sucia» fuerza el evento aunque la sala no esté bloqueada.
No validado: la barra «LIMPIANDO» solo se comprobó por lógica, no con captura.

### V5.3 · Informe consolidado (Chromium, semilla 7, sin errores de consola)
Día completo con jugador pasivo hasta el resumen: Mostrador 10 servicios + 13 abandonos (media 06:53, rojo), AutoKing 4 + 7 (08:13, rojo), Delivery 2 + 2 (01:15, rojo); KPI de fin de día −90 (3 × −30), mostrado aparte de los puntos de eventos. Valida el flujo completo y el sistema de tiempos, no el equilibrio de dificultad con un jugador activo.
### V5.4 · KPI normalizado (tests 16–19) y penalización de reseñas
Chromium, sin errores de consola, registros inyectados con tiempos conocidos:
- Mostrador y AutoKing: verde/amarillo/rojo/abandono registran 210 / 300 / 420 / 540 s.
- Delivery: 30 / 45 / 60 / 90 s.
- Media aritmética: registros 210, 300 y 540 → 350 s; último 540 s; 2 medidos y 1 abandono.
- Cada reseña negativa por abandono resta `operations.reviews.penalty` (−10), en la categoría «Reseñas negativas» del desglose final.
Pendiente de capturas: barra «LIMPIANDO», estados sobre clientes y NAVIGATION_RECOVERY con atasco real.

### V5.5 · Panel, AutoKing y limpieza de mesa (Chromium)
- Limpiar una mesa sucia pulsándola en el mapa (sin evento): el encargado camina, el evento pasa a `inProgress` y la mesa queda limpia (`tablesCleaned` +1).
- Selector de prioridad: el icono de AutoKing mostraba texto corrupto («â—†») porque el CSS usaba un carácter no ASCII sin `@charset`. Ahora `.s-diamond::after` usa el escape `\1F697` y se ve el coche dentro del rombo.
- Panel «Operación» abierto: pulsar dentro no mueve al encargado; el primer toque en el mapa lo cierra sin mover; el segundo toque mueve (`onTap` en `main.js`).
- AutoKing: pedido 20 s + recogida 27 s → tiempo medio 23 s (`vehicle:exit.totalDriveTime`), que alimenta el KPI.
- Atasco real (cliente con `speed=0` y destino): a los 5 s (`stallSec`) se dispara `NAVIGATION_RECOVERY` una vez, el cliente sigue vivo y sin abandono contado.
- Día completo, semilla 7, sin errores de consola: el resumen se abre; el desglose incluye «Reseñas negativas» (−230 con 23 reseñas) y las tres medias KPI en rojo (Mostrador 07:11, AutoKing 07:46, Delivery 01:19); KPI fin de día −90. Jugador pasivo, por eso el total es muy negativo.
- Sin verificar aún: captura de la barra «LIMPIANDO», estados sobre clientes, táctil real y vertical en móvil físico.

### V5.6 · Tutorial, ayudas de depuración y jugador automático
- Tutorial de primera partida (`tutorialDone=false`): se muestra al empezar (8 pasos, con «Saltar tutorial»); al terminar queda guardado. Se añadieron pasos sobre limpiar mesas, el móvil «Operación» y reasignar empleados.
- `G.debug.focusTable()` fija la cámara en una mesa sucia (limitado por el zoom máximo del viewport de pruebas: no conseguí capturar la barra «LIMPIANDO» en imagen; el evento sí pasa a `inProgress` y termina).
- `G.debug.autoplay(seed)` juega un día completo atendiendo el evento más urgente, eligiendo prioridad y respondiendo preguntas. Semilla 3: +4411 (13 abandonos, 5 mesas limpiadas); semilla 5: +5214 (12 abandonos, 7 mesas). Pasivo (semilla 7): −2340. Sin errores de consola. Es un bot simple, no equivale a un jugador humano.

### V5.2 · Panel «Operación» como móvil
Chromium, con `?debugSimulation=true`:
- Marco de móvil (muesca, hora, cierre 44 px), tarjetas por sección opacas y navegación inferior de 6 pestañas con icono (Resumen, Equipo, Puestos, Canales, Stock, Tiempos). Texto claro sobre fondo oscuro sólido.
- Captura en 1280×720: el panel queda a la derecha, por encima del panel de depuración (z-index 12) y sin solapar texto.
- Viewport 740×360: panel anclado bajo la barra, cuerpo con scroll (≈93 px visibles; justo, pero usable).
No validado: móvil físico, contraste medido con herramienta específica, vista vertical (portrait).


## V5.7 · Feedback: X del móvil y posicionamiento
- Causa de la X: el panel se reconstruía entero en cada tick y el botón se sustituía entre pulsar y soltar. Ahora cabecera y pestañas persisten y el cuerpo no se refresca mientras hay un puntero pulsado.
- Verificado en Chromium con ratón real (pulsación corta y de 700 ms): 4/4 cierres y reaperturas, sin errores de consola.
- Posicionamiento: un único scroll (.rp-list), cabecera compacta y acciones fijas. En 1280×720 el modal ocupa 60–712 px sin desbordes externos.
- No validado: táctil real, vista vertical y ancho < 760 px tras compactar.

## V5.8 · Panel persistente, Stock y título
- El panel Operación ya no se cierra al tocar el mapa: solo con la X o con el botón Operación. La X cierra también en pointerup.
- Stock: «Preparación restante / Pendiente 93 %» pasa a «Producto preparado» con barra de progreso.
- Menú de inicio: letras flotantes «RBE · TURNO DE ENCARGADO» sobre el mapa (se retira al empezar o continuar).
- Verificado en Chromium: clic en mapa con panel abierto lo mantiene abierto, cierre por X y por botón, logo se retira al empezar, sin errores. No verificado: captura fiable del logo, táctil real.

## V5.9 · Cierre real del móvil y logo centrado
- Causa real de la X: #operationsPanel.phone tenía display:flex, que anulaba el atributo hidden; el panel se marcaba cerrado pero seguía visible. Añadido #operationsPanel[hidden]{display:none!important} y animación de entrada.
- Verificado midiendo display y ancho calculados: cerrado none/0, abierto flex/310; por X y por botón Operación.
- Logo centrado sobre el área del mapa (left 28%, ancho 54vw). Medido a 1280 px: centro en x≈686.
- Lección: las pruebas anteriores solo miraban la propiedad hidden, no la visibilidad real.

## V5.10 · Tab y flujo del kiosco
- Tab abre y cierra el panel Operación (si no hay modal ni tutorial). Verificado: flex, none.
- Kiosco: el cliente pide en su kiosco con barra de progreso (4–6 s), libera el kiosco y espera en la zona de mostrador (5 puestos de recogida, x≈814). La impaciencia sigue corriendo y el pedido lo entrega la posición de entregas o el encargado. Traza en test: pedido 5 s → recogida (814,484) → pedido listo → sale/se sienta; kioscos y reservas liberados, sin errores.
- No validado: captura visual de la barra azul del kiosco, saturación con varios clientes a la vez.


## V5.11 · Reparto comida/cena con gráfica procedural
- Posicionamiento paso 1: solo COMIDA y CENA (sin merienda) y gráfica de clientes previstos por hora, derivada de la semilla (cambia cada día; misma semilla = mismo reparto).
- La demanda real (ArrivalDirector) usa el reparto: comida = 12–19 h, cena = 19–01 h (según fases).
- Verificado en Chromium 1280×720: modal sin desbordar, 3 semillas dan repartos distintos, la partida arranca y el intervalo de llegadas refleja el reparto. No contrastado: recuento total de llegadas de un día completo frente a la cifra mostrada (es una estimación).


## V5.12 · Plantilla y carga procedurales por dificultad
- Cada dificultad define rangos (staffRange, load = demanda por empleado). Con la semilla se sortea plantilla (Normal 7–10, Difícil 9–12, Experto 11–14), carga y reparto comida/cena (36–64 %).
- La gráfica usa el mismo modelo de llegadas que la simulación (ArrivalDirector.hourlyForecast); la llegada se normaliza por velocidad de reloj. Corte comida/cena a las 19:00.
- Medido (bot simple): previsto vs real 31/36, 41/43, 66/66, 83/80, 111/92, 134/111 (clientes/día). Clientes por empleado ≈ 3–4 / 6–7 / 8–9.
- Bot: abandonos 19 (8 emp.) y 8 (10 emp.) en Normal; 37 en Difícil; 52 en Experto. Sin prueba con jugador humano; equilibrio por validar.


## V5.13 · Ausencias y vacantes de turno

- **Ausencias:** plan por semilla al iniciar el día, como máximo una baja por turno (comida 10:00, cena 18:00 + 5–40 min). Probabilidad por turno 2 % / 3 % / 4 % según dificultad (medido sobre 2000 semillas: ≈ 4 %, 6 %, 8 % de días con alguna baja). Aviso `⚠️ Equipo NN no se ha presentado…` de 9 s y marca en el botón Operación y en la pestaña Vacantes. `G.debug.absence()` fuerza una baja.
- **Vacantes (móvil › Vacantes):** refuerzo 1000 pts o experto ⭐ 2000 pts (50 % más rápido). Confirmación en dos pasos, botón deshabilitado si faltan puntos, tope de 2 refuerzos extra además de cubrir bajas. «Seguir con el equipo actual» no cuesta puntos. Más demanda (+6 % refuerzo, +8 % experto, `ArrivalDirector.interval`) solo si se contrata sin baja que cubrir.
- El empleado entra por la puerta de empleados y va al puesto más crítico (sin cobertura, luego mayor déficit). Estrella ★ sobre el experto y en su etiqueta. Categoría «Vacantes cubiertas» en el resumen final.
- **Verificado (Chromium):** clics reales en pestaña, Contratar y Confirmar descuentan puntos y reducen vacantes; 7 pestañas sin desbordar a 310 px; experto con `workSpeed` 1,5; día completo con bot hasta 01:00 sin errores de consola; snapshot/restore de `staffing`.
- **No verificado:** aspecto visual de la estrella en pantalla, retomar partida real desde guardado, equilibrio con un jugador humano.
## V5.14 Tutorial, delivery y traslado
- Tutorial ampliado a 11 pasos (TAB/X en Operación, puestos sin cubrir, ausencias y Vacantes, demanda extra). Verificado que el panel cabe en 1280x720.
- Delivery sin cobertura: un rider ambiental con pedido listo (awaiting-channel) genera un evento atendible; al atenderlo se entrega el pedido (ProductionSystem.deliver). Verificado semilla 31337: evento aparece, resuelto excelente y el rider se va. Con delivery cubierto el equipo sigue resolviéndolo solo.
- Traslado en sala: assignPosition cancela el autoJob (AutonomySystem.cancelFor), goHome no actúa durante un traslado y hay watchdog que reintenta o coloca al empleado. Verificado semilla 4242: empleado de sala con tarea activa llega a Mostrador y pasa a WORKING.
- Autoplay semilla 77 hasta 01:00 sin errores de consola.
- No verificado: prueba manual con ratón y estrella ★ visual.


## V5.15 · Lluvia procedural
- Probabilidad de lluvia (5-95 %) visible en el planificador; la semilla decide si llueve y cuándo (30 % desde las 10:00).
- Con lluvia: mostrador y kiosco x0.25, sala x0.45, AutoKing x1.4, delivery x1.6 (ver operations.weather).
- Efecto visual solo en exterior (máscara INDOOR en Renderer.drawRain). Toast al empezar y terminar.
- Verificado: semilla 27 (85 %, llueve desde 10:00 hasta ~15:15) con captura exterior con lluvia e interior limpio; autoplay semillas 27 y 7 sin errores de consola.
- No verificado: medición numérica de llegadas por canal con/sin lluvia, fin de lluvia en pantalla, rendimiento en equipos lentos.


## V5.16 · Sonido: lluvia, cocina, fritadora y AutoKing
- Lluvia: capa de ruido en el bus de ambiente, proporcional a la intensidad; suena al 40 % si el encargado está dentro del edificio.
- Cocina: capa de chisporroteo más golpes metálicos y siseos aleatorios; más fuertes cerca de la cocina.
- Fritadora: 4 pitidos cortos al pasar las patatas a amarillo (stock <= mínimo) y de nuevo, más agudos, al llegar a rojo (0). Evento production:fryer-alert.
- AutoKing: aviso de dos notas solo al detenerse el coche en el punto de pedido (vehicle:stop, stop=order).
- Verificado por instrumentación (llamadas a WebAudio, sin errores de consola): pitidos amarillo/rojo sin repetir, 3 paradas de pedido con aviso, ganancias de lluvia y chisporroteo. No verificado a oído: mezcla y volúmenes.

## V5.17 · Preguntas sin «Continuar» y nuevas preguntas al repetir
- Al contestar una pregunta emergente se cierra sola y aparece un aviso breve (acierto con puntos, o error con descuento y explicación). Las quejas funcionan igual. Probado simulando la queja, no con una real.
- Al repetir una revisión fallada se genera otra pregunta del banco documental. La pregunta fallada no vuelve a salir mientras haya alternativa, y si el banco de la zona se agota se reinicia el ciclo sin repetir la última.
- Banco ampliado de 14 a 30 preguntas, todas con documento y sección de origen (manual de gestión de stock, Manual de Gerentes: nulos, reclamaciones, OSAT, Zenput, REV, horarios).
- Comprobado en navegador: 4 fallos seguidos en cada revisión sin repetir pregunta, acierto posterior sin puntuar de nuevo y autoplay completo sin errores.

## V5.18 · Panel de tareas con cierre automático
- Panel de preparación: con el restaurante abierto se cierra solo a las 12:20. Panel CSL: se abre al empezar el recorrido y se cierra solo a las 17:30.
- Si el jugador lo abre o cierra a mano, no se vuelve a cerrar solo hasta la siguiente fase (preparación → CSL).
- Al iniciar una partida nueva el panel vuelve a mostrarse.
- Comprobado en navegador (recargando entre pruebas): visible a las 12:18 y oculto a las 12:21; visible a las 17:28 y oculto a las 17:31; con apertura manual a las 12:18 se queda abierto en 12:21 y el CSL vuelve a cerrarse solo.

## V5.19 · Audio por capas (AudioManager)

**Alcance.** `src\systems\AudioManager.js` extiende `AudioSystem` (API `G.audio.play/step/update/...` intacta) y se carga desde `src\data\audioManifest.json` (incluido en `bundle.js`). No cambia lógica, mapa ni arte; solo conecta eventos existentes con sonidos.

**Procedencia y licencia.** Todo se sintetiza con WebAudio (osciladores y ruido filtrado). No hay archivos de terceros; `variants` del manifiesto son recetas de síntesis.

**Implementado**
- Buses: ambience, weather, kitchen, customers, vehicles, ui, events (volumen, `maxVoices`, prioridad). Ajustes nuevos: volumen de alertas e interfaz, «Reducir estímulos sonoros» y «Subtítulos de sonido» (localStorage).
- `emit({event, x, y})` único: presupuesto de voces (22; decorativos se descartan desde 16; prioridad 3 nunca se descarta), límites por familia (`minInterval`, `maxConcurrent`, ventana tipo coalescing, `stagger` para alertas y coches), variantes sin repetir la anterior, pitch aleatorio ±2–6 %.
- Ducking: las alertas bajan el ambiente 4 dB y se recupera en ~1,2 s.
- Espacial: oyente = avatar; pan ≤ 0,6, atenuación NEAR/MEDIUM/FAR/fuera de rango, oclusión (low-pass y menos volumen) exterior↔interior y cocina/baños↔sala; reverb ligera por zona (cocina corta, sala, baños, sin reverb fuera).
- Clima: 4 capas (exterior, interior amortiguada, cristal, superficie fuerte) con crossfade por posición e intensidad; coches con variante mojada.
- Ambiente: room tone por fase (10:00 dormido → preparación → servicio), cocina por densidad de pedidos, murmullo por ocupación de sala, base de cola del AutoKing según nº de coches.
- Eventos nuevos: llegada de delivery (distinta al AutoKing), cliente entra/se sienta/se va (con probabilidad), bandeja, cliente atendido (tic discreto), reseña negativa, UI (toque, abrir/cerrar panel). `autokingOrder` sigue solo en el punto de pedido.
- Pasos: por distancia recorrida y superficie (baldosa, asfalto, pavimento exterior), no por timer. No van sincronizados al frame de la animación.
- Depuración: `?audioDebug=1` o `G.audio.debug(true)` (voces, zona, lluvia, listener, dB, clic en bus = mute/solo) y `G.audio.stats()`; avisa con `AUDIO_DENSITY_WARNING`.

**Pruebas (por instrumentación; no se ha escuchado)**
- 10:00: cocina `sizzle`=0, room tone 0,018, fase 0,45.
- Lluvia = 1: fuera ext 0,157 / int 0,041; dentro ext 0,037 / int 0,119; junto a cristal `rainWin` 0,078 (dentro lejos 0,015).
- Ráfaga de 40 decorativos + 6 alertas + fritadora + AutoKing: las 6 alertas, la fritadora y el AutoKing suenan; decorativos limitados a 1; voces ≤ presupuesto.
- 6 coches a la vez: suenan 3 (escalonados), 3 descartados. Variantes sin repetición en 14 emisiones.
- Autoplay de un día completo sin errores de consola.

**Pendiente / no hecho**
- Calibrar de oído la mezcla (niveles son sintéticos).
- Sin música, sin círculos de radio en pantalla, sin EQUIPMENT_POWER_ON, PREP_* ni CLEAN_* específicos, ni pasos de NPC; pasos no atados al frame de la animación.

## V5.20 · Preparación del encargado, puestos libres y clasificación
- «Preparación» sale del posicionamiento: tarea repetible del encargado en la cámara de congelado (7 s, ≥60 % de la demanda prevista del tramo; 1 reposición forzada por tramo).
- Montaje en el mostrador, a la izquierda de los empleados de mostrador.
- Reposiciones consumen la reserva; el excedente penaliza al final («Desperdicio de producto»).
- El encargado puede ocupar puestos libres (círculo oscuro) y cubrirlos mientras está quieto.
- Parpadeo: Renderer.resize() solo reasigna el lienzo si cambia el tamaño (0 reasignaciones al abrir prioridad).
- Clasificación TOP 10 (podio con avatar + lista), guardado de nombre al final y acceso desde el menú.
- Verificado en navegador: ocupar montaje, preparar, autoplay del día completo sin errores, resumen con nombre y clasificación.

## V5.21 · Posiciones según plano, inicio 09:00 y factores críticos
- Puestos reubicados según REFERENCIA POSICIONAMIENTO.png (cocina, complementos, patatas, montaje/entregas, mostrador, AutoKing en la ventana de recogida); todos alcanzables por la rejilla.
- Turno desde las 09:00 (apertura 12:00, checklist 11:15). Lluvia «desde el inicio» = 09:00.
- Nueva revisión «factores críticos» en cocina: solo preguntas FOOD_SAFETY (7 existentes + 6 nuevas del Manual de Gerentes, pool `food-safety`). Soporta repetición con pregunta nueva al fallar.
- Barra de progreso con segundos restantes sobre el encargado al preparar producto en la cámara.

## V5.22 · Experto con segunda posición
- Puesto «Fritos» recupera su nombre.
- El empleado experto (2000 pts), cuando su puesto no tiene trabajo pendiente, cubre una segunda posición crítica con trabajo (prioriza la descubierta) a su ritmo +50 %. Se muestra como «★ +icono» sobre él y se libera al volver el trabajo a su puesto.
- Verificado con experto en Delivery: cubrió cocina y fritos durante el servicio (capacidad cocina 2).

## V5.23 · Tutorial interactivo en cada partida
- El tutorial se muestra al iniciar cada partida (se eliminó «Repetir tutorial» de Ajustes). Se puede saltar con «Saltar tutorial» o Esc, y cada paso con «Siguiente/Omitir paso».
- Mientras dura, el reloj y la simulación están congelados; solo se mueve el encargado.
- Pasos interactivos que avanzan solos al hacer la acción: mover, abrir Operación, cerrarla y pulsar un empleado.
- Los tests de consola usan `G.noTutorial = true`.
