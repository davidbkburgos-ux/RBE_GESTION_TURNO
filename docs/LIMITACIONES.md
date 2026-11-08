# Limitaciones conocidas

- Sprites de personajes, vehículos, props, iconos y minijuegos generados con Summer Engine (4 direcciones, normalizados con tools/normalize_sprites.py). El dibujo procedural queda solo como respaldo si una imagen no carga.
- El fondo es una imagen plana: la iluminación se simula con superposiciones.
- Los personajes son pequeños a zoom por defecto en pantallas estrechas; usar zoom o seguimiento de cámara.
- Frecuencia de eventos baja con el jugador inactivo (diseño intencionado de primera partida).
- Audio grabado generado con Summer (efectos, ambientes en bucle y música de punta/valle); la síntesis WebAudio queda como respaldo.
- Pruebas táctiles en dispositivo real y de múltiples navegadores pendientes.
- Cobertura de preguntas limitada por la base de conocimiento disponible.
- Provisional: factores KPI (mostrador 8, AutoKing 12, delivery 1,5), objetivos de fase AutoKing (pedido 20 s, recogida 25 s) y umbrales de espera de mesa (queja 25 s, abandono 50 s) son decisiones de diseño, no datos documentales.
- Sin probar: móvil físico, estados de cliente en pantallas táctiles pequeñas, NAVIGATION_RECOVERY forzando atascos reales.
- Complementos, bebidas, postres y limpieza no son estaciones físicas independientes en el plano.
- Decisión de alcance: los baños son solo un evento de limpieza y los exteriores solo tienen revisión inicial y recorrido CSL; no existe procedimiento documental específico para ellos.

## Etapa 3 (nov. 2026)
- Cobertura secundaria: el empleado base cubre el puesto vecino de su zona (cocina: parrilla/patatas/montaje/chef; frente: mostrador/entregas/Auto) cuando el suyo no tiene trabajo.
- Vigilante anti-atasco en EventSystem: un evento en curso sin nadie trabajándolo (o con el encargado que cambió de plan) vuelve a pendiente en 1–1,5 s.
- Punta/valle: aviso 20 min antes de cada tramo, preparación anticipada y caducidad del 50 % del producto preparado sobrante al cambiar de tramo (COGS estimado en €).
- Reparto de turnos propuesto por demanda prevista (mínimo 4 por turno); Entresemana empieza en 8 empleados.
- Valoraciones OSAT/Google del resumen: fórmula didáctica a partir de fallos, bandas KPI, abandonos y reseñas; no es el cálculo oficial.
- Costes por unidad de COGS (stockPrep.unitCost) son estimaciones de diseño.
