# dsh-plugin-forecast-lite — Forecast Lite

Pronostica series numericas con media movil o regresion lineal simple, mostrando tendencia, estadisticas y predicciones, con guardado opcional.

## Tools

| Tool | Qué hace |
|---|---|
| `status` | Estado |
| `forecast` | Pronosticar |

## Instalación

Desde **DSH → Settings → Plugins** instala `github:thegabopacheco-sudo/dsh-plugin-forecast-lite` y permite el script de instalación.

```
dsh plugin --profile <perfil> add github:thegabopacheco-sudo/dsh-plugin-forecast-lite
```

## Seguridad

- Lectura por defecto; escritura solo con `confirm:true` y pedido explícito.
- `DSH_FORECAST_LITE_MODE=read-only` desactiva acciones.
- Listas blancas y auditoría en `<DSH_HOME>\cache\forecast-lite\audit.jsonl`.

## Licencia

MIT © thegabopacheco-sudo
