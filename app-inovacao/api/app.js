import { readFileSync } from 'fs';
import { join } from 'path';

// Serve o app respondendo a GET e POST (modo "Servidor" do Bitrix envia por POST).
let cachedHtml = null;

export default function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET' && req.method !== 'POST') { res.status(405).end(); return; }
  try {
    if (!cachedHtml) {
      cachedHtml = readFileSync(join(process.cwd(), 'public', 'index.html'), 'utf8');
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.removeHeader('X-Frame-Options');
    res.status(200).send(cachedHtml);
  } catch (e) {
    res.status(500).send('Erro ao carregar o app: ' + String(e));
  }
}
