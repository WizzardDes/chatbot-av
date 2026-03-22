const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
};

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const PORT = process.env.PORT || 3000;

// WhatsApp Business API
const WA_TOKEN = process.env.WHATSAPP_TOKEN;
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_ID || '1065059880021347';
const WA_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'accivalores-webhook-2024';

// Historial de conversación por número de WhatsApp (en memoria)
const waConversaciones = new Map();

// Contenido de los PDFs cargado al inicio
let comexContext = '';

async function cargarDocumentosComex() {
  const docsDir = path.join(__dirname, 'documentos');
  if (!fs.existsSync(docsDir)) {
    console.log('⚠️  Carpeta documentos no encontrada, continuando sin RAG.');
    return;
  }
  const archivos = fs.readdirSync(docsDir).filter(f => f.toLowerCase().endsWith('.pdf'));
  let textoTotal = '';
  for (const archivo of archivos) {
    try {
      const buffer = fs.readFileSync(path.join(docsDir, archivo));
      const data = await pdfParse(buffer);
      textoTotal += `\n=== ${archivo} ===\n${data.text.trim()}\n`;
      console.log(`✅ PDF cargado: ${archivo}`);
    } catch (e) {
      console.error(`❌ Error leyendo ${archivo}:`, e.message);
    }
  }
  comexContext = textoTotal;
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
- <a href="https://www.google.com/maps/search/Western+Union+-+Acciones+y+Valores" target="_blank">Buscar en Google Maps</a>

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
- Cuando identifiques que el cliente necesita un servicio específico, invítalo a continuar con un link HTML así:
  · Fondos de inversión → <a href="/formulario-fondos.html" target="_blank">Completar formulario de inversión</a>
  · Western Union (giros personales o empresariales) → <a href="/formulario-western-union.html" target="_blank">Completar formulario Western Union</a>
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
  const ultimoMensaje = messages
    .filter(m => m.role === 'user')
    .pop();
  if (!ultimoMensaje) return false;
  const texto = ultimoMensaje.content.toLowerCase();
  return COMEX_KEYWORDS.some(kw => texto.includes(kw));
}

function buildSystem(incluirComex) {
  if (incluirComex && comexContext) {
    return SYSTEM_BASE + `\n\nDOCUMENTACIÓN DETALLADA DE COMERCIO EXTERIOR (usa esta info para responder con precisión):\n${comexContext}`;
  }
  return SYSTEM_BASE;
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
- Buscar en Google Maps: https://www.google.com/maps/search/Western+Union+-+Acciones+y+Valores

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
- Cuando identifiques que el cliente necesita un servicio específico, dile que un asesor lo contactará y pídele su nombre completo y el mejor horario para llamarlo
- Muestra el link de contacto solo cuando quede claro qué servicio necesita, no en el primer mensaje`;

function buildSystemWhatsapp(incluirComex) {
  if (incluirComex && comexContext) {
    return SYSTEM_WHATSAPP + `\n\nDOCUMENTACIÓN DETALLADA DE COMERCIO EXTERIOR (usa esta info para responder con precisión):\n${comexContext}`;
  }
  return SYSTEM_WHATSAPP;
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
    path: `/v22.0/${WA_PHONE_ID}/messages`,
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

function sendCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
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
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      res.writeHead(200);
      res.end('OK');

      try {
        const data = JSON.parse(body);
        const entry = data?.entry?.[0];
        const changes = entry?.changes?.[0];
        const msgObj = changes?.value?.messages?.[0];

        if (!msgObj || msgObj.type !== 'text') return;

        const from = msgObj.from;
        const texto = msgObj.text.body;

        console.log(`📱 WA [${from}]: ${texto}`);

        // Mantener historial por usuario (máx 10 turnos)
        if (!waConversaciones.has(from)) waConversaciones.set(from, []);
        const historial = waConversaciones.get(from);
        historial.push({ role: 'user', content: texto });
        if (historial.length > 20) historial.splice(0, 2);

        const incluirComex = esPreguntaComex(historial);
        const payload = JSON.stringify({
          model: 'claude-sonnet-4-20250514',
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
            'anthropic-version': '2023-06-01',
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
    // Servir archivos estáticos (.html, .css, .js, imágenes)
    const ext = path.extname(req.url);
    if (ext && MIME_TYPES[ext]) {
      const filePath = path.join(__dirname, req.url);
      if (fs.existsSync(filePath)) {
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] });
        fs.createReadStream(filePath).pipe(res);
      } else {
        res.writeHead(404);
        res.end('Archivo no encontrado');
      }
      return;
    }
    // Health check
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Servidor Acciones & Valores OK');
    return;
  }

  if (req.method === 'POST' && req.url === '/chat') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { messages } = JSON.parse(body);
        const incluirComex = esPreguntaComex(messages);
        const payload = JSON.stringify({
          model: 'claude-sonnet-4-20250514',
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
            'anthropic-version': '2023-06-01',
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
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ content: [{ text: '__SIN_CREDITOS__' }] }));
        });

        apiReq.write(payload);
        apiReq.end();

      } catch (e) {
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
