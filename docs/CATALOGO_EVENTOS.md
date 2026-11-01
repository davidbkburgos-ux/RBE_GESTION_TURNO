# Catálogo de eventos

Definidos en `src/data/events.json`; tiempos y puntos en `config.json`.

| Tipo | Canal | Ubicación | Descripción |
|---|---|---|---|
| counter | Mostrador/sala | Mostrador | Cliente entra y espera atención |
| kiosk | Mostrador/sala | Kioscos | Cliente atascado; animación de apoyo |
| pendingOrder | Mostrador/sala | Expedición | Pedido listo, cliente esperando |
| dirtyTable | Mostrador/sala | Mesa | Cliente se levanta; limpiar la mesa |
| vehicle | AutoKing | Ventana 2 | Coche llega a la segunda ventana; entrega |
| delivery | Delivery | Cubículo | Repartidor con casco espera pedido |

Estados: scheduled → appearing → pending → acknowledged → playerMoving → inProgress → resolvedExcellent / resolvedAcceptable / failed / dismissed.
Calidad: se decide al llegar el encargado; fracción del temporizador ≤0.4 excelente, ≤1.0 aceptable; expirar = fallido.
Saturación: con ≥3 eventos activos aparece el panel de prioridad de canal (con enfriamiento).
El director introduce eventos en 3 etapas: individuales, parejas, multicanal.
