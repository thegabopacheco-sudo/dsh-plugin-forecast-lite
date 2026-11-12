// Test end-to-end de forecast-lite.
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const packageDir = path.resolve(import.meta.dirname, '..');
const tmpDir = path.join(packageDir, 'test', 'tmp');
rmSync(tmpDir, { recursive: true, force: true });
const home = path.join(tmpDir, 'dsh-home');
mkdirSync(path.join(home, 'forecast-lite'), { recursive: true });
writeFileSync(path.join(home, 'forecast-lite', 'config.json'), JSON.stringify({ allowedPaths: [tmpDir] }), 'utf8');

function makeClient(extraEnv = {}) {
  const entry = process.env.FORECAST_SERVER ? path.resolve(process.env.FORECAST_SERVER) : path.join(packageDir, 'server.mjs');
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows', PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME || process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP, DSH_HOME: home, ...extraEnv }, stderr: 'pipe' });
  transport.stderr?.on('data', (c) => process.stderr.write(`[server] ${c}`));
  const client = new Client({ name: 'forecast-test', version: '1.0.0' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } });
  return client.connect(transport).then(() => ({ client, transport }));
}
const textOf = (r) => (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

const { client, transport } = await makeClient();
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
console.log('--- status ---'); console.log(textOf(await client.callTool({ name: 'status', arguments: {} })));
const linear = textOf(await client.callTool({ name: 'forecast', arguments: { values: [1, 2, 3, 4], periods: 3, method: 'linear' } }));
console.log('--- linear ---'); console.log(linear);
console.log('tendencia al alza:', linear.includes('al alza'));
console.log('pendiente 1:', linear.includes('pendiente 1.000'));
console.log('predicciones 5,6,7:', linear.includes('5, 6, 7'));
console.log('base n=4:', linear.includes('n=4'));
const mean = textOf(await client.callTool({ name: 'forecast', arguments: { values: [1, 2, 3], periods: 2, method: 'mean' } }));
console.log('--- mean ---'); console.log(mean);
console.log('media 2 y predicciones:', mean.includes('media 2.00') && mean.includes('2, 2'));
const short = await client.callTool({ name: 'forecast', arguments: { values: [1, 2] } });
console.log('serie corta rechazada:', short.isError === true || textOf(short).includes('al menos 3'));
const noConfirm = await client.callTool({ name: 'forecast', arguments: { values: [1, 2, 3], output: path.join(tmpDir, 'f.json') } });
console.log('output sin confirm isError:', noConfirm.isError === true);
const saved = await client.callTool({ name: 'forecast', arguments: { values: [2, 4, 6], output: path.join(tmpDir, 'f.json'), confirm: true } });
const savedText = textOf(saved);
const file = savedText.replace('Guardado: ', '').split('\n')[0];
console.log('archivo escrito:', existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).predictions.length === 3);
await client.close(); try { await transport.close?.(); } catch {}
const { client: roClient, transport: roTransport } = await makeClient({ DSH_FORECAST_MODE: 'read-only' });
const roSave = await roClient.callTool({ name: 'forecast', arguments: { values: [1, 2, 3], output: path.join(tmpDir, 'ro.json'), confirm: true } });
console.log('read-only output isError:', roSave.isError === true);
await roClient.close(); try { await roTransport.close?.(); } catch {}
console.log('OK');
