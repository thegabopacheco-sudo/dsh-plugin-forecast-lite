#!/usr/bin/env node
// dsh-plugin-forecast-lite — pronósticos simples de series numéricas.
// Tools: status, forecast.

import path from 'node:path';
import os from 'node:os';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const VERSION = '0.1.0';
const DSH_HOME = (() => {
  const v = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  return v || path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.dsh');
})();
const CONFIG_FILE = path.join(DSH_HOME, 'forecast-lite', 'config.json');
const CACHE_DIR = path.join(DSH_HOME, 'cache', 'forecast-lite');
const READ_ONLY = String(process.env.DSH_FORECAST_MODE || '').toLowerCase() === 'read-only';
const MAX_POINTS = 1000;
const maxPeriods = 60;
const log = (m) => process.stderr.write(`[forecast] ${m}\n`);

function loadConfig() { try { if (existsSync(CONFIG_FILE)) return { allowedPaths: [], ...(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) || {}) }; } catch { /* defaults */ } return { allowedPaths: [] }; }
function allowedRoots() { const configured = loadConfig().allowedPaths; return (Array.isArray(configured) && configured.length ? configured : [process.env.USERPROFILE || process.env.HOME || os.homedir()]).map((item) => path.resolve(item)); }
function isAllowed(target) { const resolved = path.resolve(target); return resolved === CACHE_DIR || resolved.startsWith(CACHE_DIR + path.sep) || allowedRoots().some((root) => resolved === root || resolved.startsWith(root + path.sep)); }
function stats(values) { const mean = values.reduce((sum, value) => sum + value, 0) / values.length; return { count: values.length, mean, min: Math.min(...values), max: Math.max(...values), last: values[values.length - 1] }; }
function linearFit(values) {
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < n; index++) { numerator += (index - xMean) * (values[index] - yMean); denominator += (index - xMean) ** 2; }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = yMean - slope * xMean;
  return { slope, intercept };
}
function forecastSeries(values, periods, method) {
  if (!Array.isArray(values) || values.length < 3) throw new Error('values necesita al menos 3 números');
  if (values.length > MAX_POINTS) throw new Error(`máximo ${MAX_POINTS} valores`);
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('todos los valores deben ser números finitos');
  const base = stats(values);
  let predictions = [];
  let trend = 'lateral';
  let slope = 0;
  if (method === 'linear') {
    const fit = linearFit(values);
    slope = fit.slope;
    predictions = Array.from({ length: periods }, (_, index) => fit.intercept + fit.slope * (values.length + index));
    if (slope > 0.01) trend = 'al alza';
    else if (slope < -0.01) trend = 'a la baja';
  } else {
    const window = values.slice(-Math.min(3, values.length));
    const average = window.reduce((sum, value) => sum + value, 0) / window.length;
    predictions = Array.from({ length: periods }, () => average);
    const delta = average - base.last;
    if (delta > 0.01) trend = 'al alza';
    else if (delta < -0.01) trend = 'a la baja';
  }
  return { method, periods, trend, slope, base, predictions: predictions.map((value) => Math.round(value * 1000) / 1000) };
}
function textResult(text) { return { content: [{ type: 'text', text }] }; }
function uniquePath(target) { if (!existsSync(target)) return target; const parsed = path.parse(target); for (let index = 1; index < 1000; index++) { const candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`); if (!existsSync(candidate)) return candidate; } throw new Error('no se pudo generar nombre único'); }

function buildInstructions() {
  return [
    'Forecast Lite: pronostica series numéricas simples.',
    '',
    `Salidas: ${CACHE_DIR}`,
    '',
    'Herramientas: status, forecast.',
    '',
    'Reglas:',
    '- Métodos: media (últimos 3 valores) o regresión lineal simple.',
    '- Necesita al menos 3 valores; devuelve tendencia y estadísticas reales.',
    '- Con output escribir requiere confirm:true; respeta allowedPaths y no sobrescribe.',
    '- No prometas precisión: es un pronóstico heurístico.',
  ].join('\n');
}

function buildServer() {
  const server = new McpServer({ name: 'dsh-plugin-forecast-lite', version: VERSION }, { capabilities: { tools: {} }, instructions: buildInstructions() });
  server.registerTool('status', { title: 'Estado', description: 'Rutas permitidas y modo.', inputSchema: z.object({}) }, async () => textResult([`Rutas permitidas: ${allowedRoots().join(', ')}`, `Salida: ${CACHE_DIR}`, `Modo: ${READ_ONLY ? 'read-only' : 'normal'}`].join('\n')));
  server.registerTool('forecast', { title: 'Pronosticar', description: 'Calcula predicciones y tendencia.', inputSchema: z.object({ values: z.array(z.number()).min(3).max(MAX_POINTS), periods: z.number().int().min(1).max(maxPeriods).optional(), method: z.enum(['mean', 'linear']).optional(), output: z.string().optional(), confirm: z.boolean().optional() }) }, async (args) => {
    const result = forecastSeries(args.values, args.periods ?? 3, args.method || 'linear');
    const text = [
      `Método: ${result.method} · tendencia: ${result.trend}${result.method === 'linear' ? ` (pendiente ${result.slope.toFixed(3)})` : ''}`,
      `Base: n=${result.base.count} · media ${result.base.mean.toFixed(2)} · min ${result.base.min} · max ${result.base.max} · último ${result.base.last}`,
      `Predicciones (${result.periods}): ${result.predictions.join(', ')}`,
    ].join('\n');
    if (!args.output) return textResult(text);
    if (READ_ONLY) throw new Error('modo read-only: output deshabilitado');
    if (args.confirm !== true) throw new Error('output requiere confirm:true y pedido explícito');
    const target = path.resolve(args.output);
    if (!isAllowed(target)) throw new Error(`ruta de salida no permitida: ${target}`);
    mkdirSync(path.dirname(target), { recursive: true });
    const file = uniquePath(target);
    const payload = { generatedAt: new Date().toISOString(), ...result, meta: text };
    writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    return textResult(`Guardado: ${file}\n\n${text}`);
  });
  return server;
}

try { mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignora */ }
log(`modo: ${READ_ONLY ? 'read-only' : 'normal'}`);
serveStdio(buildServer, { onerror: (e) => log(`serveStdio: ${e.message}`) });
process.on('uncaughtException', (e) => log(`excepción: ${e.message}`));
process.on('unhandledRejection', (e) => log(`rechazo: ${e && e.message ? e.message : String(e)}`));
