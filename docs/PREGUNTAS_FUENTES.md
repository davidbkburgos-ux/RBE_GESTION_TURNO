# Preguntas y fuentes documentales

Las preguntas están en `src/data/questions.json`. Cada pregunta incorpora `zones`, `topics`, `taskTypes`, `difficulty` y `sourceId`, además del objeto `source` con documento, sección y página. El jugador no ve los metadatos ni los nombres de archivo.

El selector exige coincidencia geográfica y de tipo de tarea; después pondera tema, dificultad y uso reciente. Si una zona no tiene preguntas compatibles, devuelve `null` en vez de seleccionar contenido de otra área.

Fuentes usadas (carpeta "base de conocimiento"):
- Manual de Gerentes RBE: pp. 25 (objetivos SOS), 27, 41, 116 (temperatura de carne 30 min antes; 2 h abierta), 124–125 (registros Zenput), 127, 128.
- Stock manual: p. 3.
- Dosier P&L V2.26: p. 13.

Lagunas: no se localizó un procedimiento CSL específico para exteriores. La única referencia exterior identificada es E1, sobre la colocación de POPS para generar tráfico (Manual de Gerentes RBE, sección MKT · Posición interior/exterior, p. 157); no se presenta como una rutina de limpieza exterior. Tampoco se localizaron procedimientos documentales específicos para baños; sus preguntas se apoyan en rutinas generales de revisión. No se detectaron documentos contradictorios (los dosieres V2.26 son los más recientes).

Cada pregunta tiene tres opciones, una correcta y una explicación breve. Las revisiones se puntúan una sola vez; la fuente queda disponible para trazabilidad, pero no se revela durante la partida.

## Ampliación V5.17
Preguntas nuevas K6–K11 (stock, Zenput), S6–S9 (nulos, reclamaciones, OSAT), B4–B6 (REV y limpieza) y E2–E3 (horario del Auto, reseñas). Siguen sin existir procedimientos específicos de exteriores ni de baños: esas revisiones usan rutinas generales documentadas. No se detectaron contradicciones.