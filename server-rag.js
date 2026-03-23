const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

// Carga .env si existe (solo para desarrollo local)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...rest] = line.trim().split('=');
    if (key && !key.startsWith('#') && rest.length) process.env[key] = rest.join('=');
  });
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
};

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
if (!ANTHROPIC_KEY) { console.error('ERROR: ANTHROPIC_KEY env var is required'); process.exit(1); }

const PORT = process.env.PORT || 3000;

// WhatsApp Business API (opcionales — solo requeridas si usas el canal WhatsApp)
const WA_TOKEN = process.env.WHATSAPP_TOKEN;
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_ID || '1065059880021347';
const WA_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'accivalores-webhook-2024';

if (!WA_TOKEN) console.warn('ADVERTENCIA: WHATSAPP_TOKEN no definido — canal WhatsApp deshabilitado');

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const ANTHROPIC_API_VERSION = '2023-06-01';
const GRAPH_API_VERSION = 'v22.0';

// Historial de conversación por número de WhatsApp (en memoria)
// Each entry: { history: [], lastSeen: Date }
const waConversaciones = new Map();

// Evict conversations not seen in the last 24 hours (runs every 30 minutes)
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [key, entry] of waConversaciones) {
    if (entry.lastSeen < cutoff) waConversaciones.delete(key);
  }
}, 30 * 60 * 1000).unref();

// Contenido de los PDFs cargado al inicio
let comexContext = '';

async function cargarDocumentosComex() {
  const docsDir = path.join(__dirname, 'documentos');
  try {
    await fs.promises.access(docsDir);
  } catch {
    console.log('⚠️  Carpeta documentos no encontrada, continuando sin RAG.');
    return;
  }
  const archivos = (await fs.promises.readdir(docsDir)).filter(f => f.toLowerCase().endsWith('.pdf'));
  const parts = [];
  for (const archivo of archivos) {
    try {
      const buffer = await fs.promises.readFile(path.join(docsDir, archivo));
      const data = await pdfParse(buffer);
      parts.push(`\n=== ${archivo} ===\n${data.text.trim()}\n`);
      console.log(`✅ PDF cargado: ${archivo}`);
    } catch (e) {
      console.error(`❌ Error leyendo ${archivo}:`, e.message);
    }
  }
  comexContext = parts.join('');
  if (comexContext) {
    const comexSection = `\n\nDOCUMENTACIÓN DETALLADA DE COMERCIO EXTERIOR (usa esta info para responder con precisión):\n${comexContext}`;
    SYSTEM_WEB_COMEX = SYSTEM_BASE + comexSection;
    SYSTEM_WA_COMEX = SYSTEM_WHATSAPP + comexSection;
  }
}

const SYSTEM_BASE = `Eres el asistente virtual oficial de Acciones & Valores S.A. (accivalores.com), agente oficial de Western Union en Colombia. La firma comisionista de bolsa más antigua de Colombia, fundada en 1959. Más de 65 años de experiencia, +180 oficinas para giros Western Union, 219+ agencias nacionales, 800+ colaboradores. Calificación Fitch Ratings: "Fuerte(col)". Vigilada por la Superintendencia Financiera de Colombia.

CONTACTO: WhatsApp: +573112160255 | Call center: 6015143343 | Línea nacional: 018000111700 | PBX: 6013257800 | servicioalcliente@accivalores.com | Sede: Calle 72 No. 7-64, piso 11, Bogotá.

FONDOS DE INVERSIÓN (14 fondos):
Conservador: Accival Vista (liquidez inmediata), Accicuenta, Renta Fija 180, SiRenta.
Moderado: Estrategia Global (desde $50.000 COP), Accival USD (sigue el dólar), FIC Potencial USA.
Agresivo: Acciones Dinámico, ETF 500 US (S&P500, desde $50.000), Acciones USA VOO (desde $50.000), FIC Acciones Brasil (protección 100% capital).
Capital Privado: FCP Fore (inmuebles AAA), FCP Deuda Internacional (Blackstone/Apollo, USD).

WESTERN UNION - COBRAR O ENVIAR GIRO:
1. Portal: https://portalclientes.accivalores.com/welcome/iniciar-sesion
2. Registrarse o ingresar
3. Seleccionar "Cotizar y envía" o "Cobrar tu giro"
4. Seguir los pasos

DIVISAS: Para tasa del dólar/euro visitar: https://www.accivalores.com/compra-y-venta-de-divisas/

OFICINAS: Si el cliente pregunta por la oficina más cercana o dónde encontrarnos, responde con los dos links:
- <a href="https://www.accivalores.com/oficinas/" target="_blank">Ver todas las oficinas</a>
- <a href="https://www.google.com/maps/search/Acciones+%26+Valores" target="_blank">Buscar en Google Maps</a>

COMERCIO EXTERIOR / PAGOS INTERNACIONALES:
Acciones & Valores ofrece soluciones de comercio exterior en alianza con Convera (red global de pagos), posicionándose en el top 10 de intermediarios cambiarios de Colombia.
- Plataforma GlobalPay: gestión 100% digital de pagos internacionales, sin intermediarios.
- Alcance: +130 monedas, monetizaciones en +40 monedas, 200 países y territorios.
- Coberturas cambiarias (forwards) para protegerse de la volatilidad del dólar.
- Mesa de Divisas con traders expertos y proyecciones macroeconómicas.
- Pagos CONTRAVALOR en 135 divisas desde cuenta de compensación en USD.
- Contacto Mesa de Divisas: WhatsApp 314 563 1855 | Call Center (601) 514 3343.
Cuando un cliente pregunte por comercio exterior, pagos internacionales, importaciones, exportaciones, divisas empresariales, GlobalPay o coberturas cambiarias, responde con esta información y ofrece conectarlos con un asesor especializado.

PREGUNTAS FRECUENTES:
- Ceder acciones: diligenciar Formato de Cesión, plazo 10 días hábiles
- Trasladar acciones a otra firma: Formato de Traslado, costo $176.500 IVA incluido, 15 días hábiles
- Certificados y extractos: portal https://portalclientes.accivalores.com/iniciar-sesion
- Ser cliente: https://www.accivalores.com/vinculacion-digital
- PQR: accivalores.com/pqrs
- Actualizar información: mínimo 1 vez al año

REGLAS:
- Responde en español, profesional y cercano
- Máximo 3 párrafos cortos
- Links como HTML: <a href="URL" target="_blank">texto</a>
- Divisas personales: redirigir a <a href="https://www.accivalores.com/compra-y-venta-de-divisas/" target="_blank">ver tasa aquí</a>
- Cuando el cliente mencione que quiere enviar o recibir dinero al exterior y no quede claro si es personal o empresarial, hazle SIEMPRE esta pregunta antes de continuar: "¿El pago es para una persona (familiar, amigo) o para un proveedor/empresa en el exterior?"
  · Responde "persona" o similar → Western Union
  · Responde "proveedor", "empresa", "negocio" o similar → Comercio Exterior
- Cuando identifiques que el cliente necesita un servicio específico, invítalo a continuar con un link HTML así:
  · Fondos de inversión → <a href="/formulario-fondos.html" target="_blank">Completar formulario de inversión</a>
  · Western Union (giros personales) → <a href="/formulario-western-union.html" target="_blank">Completar formulario Western Union</a>
  · Comercio exterior, pagos internacionales, coberturas, GlobalPay → <a href="/formulario-comercio-exterior.html" target="_blank">Completar formulario Comercio Exterior</a>
- Muestra el link solo cuando ya quede claro qué servicio necesita el cliente, no en el primer mensaje`;

// Palabras clave para detectar preguntas de comercio exterior
const COMEX_KEYWORDS = [
  'comercio exterior', 'pago internacional', 'pagos internacionales',
  'importacion', 'importación', 'exportacion', 'exportación',
  'globalpay', 'global pay', 'convera', 'cobertura cambiaria',
  'forward', 'mesa de divisas', 'divisa empresarial', 'divisa empresa',
  'transferencia internacional', 'giro internacional', 'moneda extranjera empresa',
  'contravalor', 'volatilidad dolar', 'volatilidad del dólar',
  'pago exterior', 'proveedor extranjero', 'proveedor internacional'
];

function esPreguntaComex(messages) {
  const ultimoMensaje = [...messages].reverse().find(m => m.role === 'user');
  if (!ultimoMensaje) return false;
  const texto = ultimoMensaje.content.toLowerCase();
  return COMEX_KEYWORDS.some(kw => texto.includes(kw));
}

let SYSTEM_WEB = SYSTEM_BASE;
let SYSTEM_WEB_COMEX = SYSTEM_BASE;

function buildSystem(incluirComex) {
  return incluirComex ? SYSTEM_WEB_COMEX : SYSTEM_WEB;
}

// System prompt adaptado para WhatsApp (sin HTML, links en texto plano)
const SYSTEM_WHATSAPP = `Eres el asistente virtual oficial de Acciones & Valores S.A. (accivalores.com), agente oficial de Western Union en Colombia. La firma comisionista de bolsa más antigua de Colombia, fundada en 1959. Más de 65 años de experiencia, +180 oficinas para giros Western Union, 219+ agencias nacionales, 800+ colaboradores. Calificación Fitch Ratings: "Fuerte(col)". Vigilada por la Superintendencia Financiera de Colombia.

CONTACTO: WhatsApp: +573112160255 | Call center: 6015143343 | Línea nacional: 018000111700 | PBX: 6013257800 | servicioalcliente@accivalores.com | Sede: Calle 72 No. 7-64, piso 11, Bogotá.

FONDOS DE INVERSIÓN (14 fondos):
Conservador: Accival Vista (liquidez inmediata), Accicuenta, Renta Fija 180, SiRenta.
Moderado: Estrategia Global (desde $50.000 COP), Accival USD (sigue el dólar), FIC Potencial USA.
Agresivo: Acciones Dinámico, ETF 500 US (S&P500, desde $50.000), Acciones USA VOO (desde $50.000), FIC Acciones Brasil (protección 100% capital).
Capital Privado: FCP Fore (inmuebles AAA), FCP Deuda Internacional (Blackstone/Apollo, USD).

WESTERN UNION - COBRAR O ENVIAR GIRO:
1. Portal: https://portalclientes.accivalores.com/welcome/iniciar-sesion
2. Registrarse o ingresar
3. Seleccionar "Cotizar y envía" o "Cobrar tu giro"
4. Seguir los pasos

DIVISAS: Para tasa del dólar/euro visitar: https://www.accivalores.com/compra-y-venta-de-divisas/

OFICINAS: Si el cliente pregunta por la oficina más cercana:
- Ver todas las oficinas: https://www.accivalores.com/oficinas/
- Buscar en Google Maps: https://www.google.com/maps/search/Acciones+%26+Valores

COMERCIO EXTERIOR / PAGOS INTERNACIONALES:
Acciones & Valores ofrece soluciones de comercio exterior en alianza con Convera (red global de pagos), posicionándose en el top 10 de intermediarios cambiarios de Colombia.
- Plataforma GlobalPay: gestión 100% digital de pagos internacionales, sin intermediarios.
- Alcance: +130 monedas, monetizaciones en +40 monedas, 200 países y territorios.
- Coberturas cambiarias (forwards) para protegerse de la volatilidad del dólar.
- Mesa de Divisas con traders expertos y proyecciones macroeconómicas.
- Pagos CONTRAVALOR en 135 divisas desde cuenta de compensación en USD.
- Contacto Mesa de Divisas: WhatsApp 314 563 1855 | Call Center (601) 514 3343.

PREGUNTAS FRECUENTES:
- Ceder acciones: diligenciar Formato de Cesión, plazo 10 días hábiles
- Trasladar acciones a otra firma: Formato de Traslado, costo $176.500 IVA incluido, 15 días hábiles
- Certificados y extractos: portal https://portalclientes.accivalores.com/iniciar-sesion
- Ser cliente: https://www.accivalores.com/vinculacion-digital
- PQR: https://www.accivalores.com/pqrs
- Actualizar información: mínimo 1 vez al año

REGLAS:
- Responde en español, profesional y cercano
- Máximo 3 párrafos cortos
- Estás en WhatsApp: usa solo texto plano, sin HTML. Los links van como URLs directas
- Cuando el cliente mencione que quiere enviar o recibir dinero al exterior y no quede claro si es personal o empresarial, hazle SIEMPRE esta pregunta antes de continuar: "¿El pago es para una persona (familiar, amigo) o para un proveedor/empresa en el exterior?"
  · Responde "persona" o similar → Western Union
  · Responde "proveedor", "empresa", "negocio" o similar → Comercio Exterior
- Cuando identifiques que el cliente necesita un servicio específico, dile que un asesor lo contactará y pídele su nombre completo y el mejor horario para llamarlo
- Muestra el link de contacto solo cuando quede claro qué servicio necesita, no en el primer mensaje`;

let SYSTEM_WA = SYSTEM_WHATSAPP;
let SYSTEM_WA_COMEX = SYSTEM_WHATSAPP;

function buildSystemWhatsapp(incluirComex) {
  return incluirComex ? SYSTEM_WA_COMEX : SYSTEM_WA;
}

// Quita etiquetas HTML de la respuesta por si acaso
function stripHtml(text) {
  return text
    .replace(/<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi, '$2: $1')
    .replace(/<[^>]+>/g, '');
}

// Envía un mensaje de texto por WhatsApp
function enviarMensajeWhatsapp(destinatario, texto) {
  const payload = JSON.stringify({
    messaging_product: 'whatsapp',
    to: destinatario,
    type: 'text',
    text: { body: texto }
  });

  const req = https.request({
    hostname: 'graph.facebook.com',
    path: `/${GRAPH_API_VERSION}/${WA_PHONE_ID}/messages`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${WA_TOKEN}`,
      'Content-Length': Buffer.byteLength(payload)
    }
  }, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      if (res.statusCode !== 200) {
        console.error('❌ Error enviando WA msg:', data);
      }
    });
  });

  req.on('error', err => console.error('❌ Error WA request:', err.message));
  req.write(payload);
  req.end();
}

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

function sendCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
}

const server = http.createServer((req, res) => {
  sendCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // ── WhatsApp webhook verification (GET) ──
  if (req.method === 'GET' && req.url.startsWith('/whatsapp-webhook')) {
    const params = new URL(req.url, 'http://localhost').searchParams;
    if (
      params.get('hub.mode') === 'subscribe' &&
      params.get('hub.verify_token') === WA_VERIFY_TOKEN
    ) {
      res.writeHead(200);
      res.end(params.get('hub.challenge'));
    } else {
      res.writeHead(403);
      res.end('Forbidden');
    }
    return;
  }

  // ── WhatsApp webhook incoming messages (POST) ──
  if (req.method === 'POST' && req.url === '/whatsapp-webhook') {
    let body = '';
    let bodySize = 0;
    const BODY_LIMIT = 65536;
    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > BODY_LIMIT) {
        res.writeHead(413);
        res.end('Payload Too Large');
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', async () => {
      if (res.writableEnded) return;
      res.writeHead(200);
      res.end('OK');

      try {
        const data = JSON.parse(body);
        const waEntry = data?.entry?.[0];
        const changes = waEntry?.changes?.[0];
        const msgObj = changes?.value?.messages?.[0];

        if (!msgObj || msgObj.type !== 'text') return;

        const from = msgObj.from;
        const texto = msgObj.text.body;

        console.log(`📱 WA [${from}]: ${texto}`);

        // Mantener historial por usuario (máx 10 turnos)
        if (!waConversaciones.has(from)) waConversaciones.set(from, { history: [], lastSeen: Date.now() });
        const entry = waConversaciones.get(from);
        entry.lastSeen = Date.now();
        const historial = entry.history;
        historial.push({ role: 'user', content: texto });
        if (historial.length > 20) historial.splice(0, 2);

        const incluirComex = esPreguntaComex(historial);
        const payload = JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 800,
          system: buildSystemWhatsapp(incluirComex),
          messages: historial
        });

        const apiReq = https.request({
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_KEY,
            'anthropic-version': ANTHROPIC_API_VERSION,
            'Content-Length': Buffer.byteLength(payload)
          }
        }, apiRes => {
          let respData = '';
          apiRes.on('data', chunk => respData += chunk);
          apiRes.on('end', () => {
            try {
              const parsed = JSON.parse(respData);
              const respuestaTexto = parsed?.content?.[0]?.text;
              if (!respuestaTexto) return;

              const textoLimpio = stripHtml(respuestaTexto);
              historial.push({ role: 'assistant', content: textoLimpio });
              enviarMensajeWhatsapp(from, textoLimpio);
            } catch (e) {
              console.error('❌ Error parseando respuesta Claude:', e.message);
            }
          });
        });

        apiReq.on('error', err => console.error('❌ Error Claude API:', err.message));
        apiReq.write(payload);
        apiReq.end();

      } catch (e) {
        console.error('❌ Error procesando WA webhook:', e.message);
      }
    });
    return;
  }

  if (req.method === 'GET') {
    // Redirigir raíz a index.html
    if (req.url === '/' || req.url === '') {
      res.writeHead(302, { Location: '/index.html' });
      res.end();
      return;
    }
    // Servir archivos estáticos (.html, .css, .js, imágenes)
    const ext = path.extname(req.url);
    if (ext && MIME_TYPES[ext]) {
      const safeBase = path.resolve(__dirname) + path.sep;
      const filePath = path.resolve(__dirname, '.' + req.url.split('?')[0]);
      if (!filePath.startsWith(safeBase)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      const stream = fs.createReadStream(filePath);
      stream.on('error', () => {
        res.writeHead(404);
        res.end('Archivo no encontrado');
      });
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] });
      stream.pipe(res);
      return;
    }
    // Health check
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Servidor Acciones & Valores OK');
    return;
  }

  if (req.method === 'POST' && req.url === '/chat') {
    let body = '';
    let bodySize = 0;
    const BODY_LIMIT = 65536;
    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > BODY_LIMIT) {
        res.writeHead(413);
        res.end('Payload Too Large');
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', async () => {
      if (res.writableEnded) return;
      try {
        const { messages } = JSON.parse(body);
        if (
          !Array.isArray(messages) ||
          messages.length > 40 ||
          !messages.every(
            m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
          )
        ) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid messages array' }));
          return;
        }
        const incluirComex = esPreguntaComex(messages);
        const payload = JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 1000,
          system: buildSystem(incluirComex),
          messages
        });

        const apiReq = https.request({
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_KEY,
            'anthropic-version': ANTHROPIC_API_VERSION,
            'Content-Length': Buffer.byteLength(payload)
          }
        }, apiRes => {
          let data = '';
          apiRes.on('data', chunk => data += chunk);
          apiRes.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(data);
          });
        });

        apiReq.on('error', err => {
          console.error('❌ Error Claude API /chat:', err);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ content: [{ text: '__SIN_CREDITOS__' }] }));
        });

        apiReq.write(payload);
        apiReq.end();

      } catch (e) {
        console.error('❌ Error procesando /chat:', e);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ content: [{ text: '__SIN_CREDITOS__' }] }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

// Cargar PDFs primero, luego arrancar el servidor
cargarDocumentosComex().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Servidor Acciones & Valores corriendo en puerto ${PORT}`);
    console.log(`📄 Documentos Comex cargados: ${comexContext ? 'SÍ' : 'NO'}`);
  });
});
