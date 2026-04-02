const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, decryptPollVote, getAggregateVotesInPollMessage, downloadMediaMessage } = require('@whiskeysockets/baileys');
const crypto = require('crypto');
const pino = require('pino');
const http = require('http');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

// Cargar .env manualmente
const envPath = path.join(__dirname, '.env');
function cargarEnv() {
    // Limpiar variables ADMIN_JID_ anteriores
    Object.keys(process.env)
        .filter(k => k.startsWith('ADMIN_JID_'))
        .forEach(k => delete process.env[k]);
    
    // Cargar .env de nuevo
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
        line = line.trim();
        if (!line || line.startsWith('#')) return;
        const idx = line.indexOf('=');
        if (idx === -1) return;
        const key = line.substring(0, idx).trim();
        const val = line.substring(idx + 1).trim();
        process.env[key] = val;
    });
}
cargarEnv();

function guardarEnEnv(key, value) {
    let content = fs.readFileSync(envPath, 'utf8');
    content += `\n${key}=${value}`;
    fs.writeFileSync(envPath, content);
    process.env[key] = value;
}

function getAdminsJID() {
    cargarEnv();
    return Object.keys(process.env)
        .filter(k => k.startsWith('ADMIN_JID_'))
        .map(k => process.env[k]);
}

const BOT_PORT = process.env.BOT_PORT || 3000;
const FLYER_PATH = path.join(__dirname, 'flyer.png');
const YAPE_NUMERO = process.env.YAPE_NUMERO || '931537599';
const YAPE_TITULAR = process.env.YAPE_TITULAR || 'Antony de la Cruz Albán';
const PRECIO = process.env.PRECIO || '10';
const LINK_CURSO = process.env.LINK_CURSO || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ADMIN2025';
const PALABRA_RESET = process.env.PALABRA_RESET || 'RESET123';

let qrImageData = '';
let isConnected = false;
let sockGlobal = null;
const jidMap = {};
const estados = {};
const pagosEsperando = {}; // msgId -> { clienteJid, nombre }

const ESTADO = {
    INICIO: 'inicio',
    ESPERANDO_DECISION: 'esperando_decision',
    ESPERANDO_PAGO: 'esperando_pago',
    VALIDANDO_PAGO: 'validando_pago',
    COMPLETADO: 'completado',
};

const server = http.createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (isConnected) {
        res.end(`<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;background:#111;color:white"><h2>✅ WhatsApp conectado!</h2></body></html>`);
    } else if (qrImageData) {
        res.end(`<html><head><meta http-equiv="refresh" content="30"></head><body style="display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;font-family:sans-serif;background:#111;color:white"><h2>📱 Escanea con WhatsApp Business</h2><img src="${qrImageData}" style="width:300px;height:300px"/></body></html>`);
    } else {
        res.end(`<html><head><meta http-equiv="refresh" content="3"></head><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;background:#111;color:white"><h2>⏳ Generando QR...</h2></body></html>`);
    }
});

server.listen(BOT_PORT, () => console.log(`🌐 Abre http://localhost:${BOT_PORT} para ver el QR`));

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function enviarMensaje(sock, remoteJid, texto) {
    await sock.sendMessage(remoteJid, { text: texto });
    await sleep(1500);
}

async function enviarImagen(sock, remoteJid, imagePath, caption = '') {
    await sock.sendMessage(remoteJid, {
        image: fs.readFileSync(imagePath),
        caption,
    });
    await sleep(1500);
}

async function enviarPoll(sock, remoteJid, pregunta, opciones) {
    await sock.sendMessage(remoteJid, {
        poll: { name: pregunta, values: opciones, selectableCount: 1 }
    });
    await sleep(1500);
}

async function getVotoPoll(sock, msg, opciones) {
    try {
        const pollUpdate = msg.message?.pollUpdateMessage;
        if (!pollUpdate) return null;
        
        // Obtener el mensaje original del poll
        const pollMsgKey = pollUpdate.pollCreationMessageKey;
        const pollMsg = await sock.loadMessage(pollMsgKey.remoteJid, pollMsgKey.id);
        if (!pollMsg) {
            console.log('No se pudo cargar el mensaje del poll');
            return null;
        }

        const decrypted = await decryptPollVote(msg, {
            pollCreatorJid: pollMsgKey.remoteJid,
            pollMsgId: pollMsgKey.id,
            pollEncKey: pollMsg.message?.pollCreationMessage?.encKey,
            pollOptions: opciones.map(name => ({ name })),
        });
        
        console.log('Voto desencriptado:', decrypted);
        if (decrypted && decrypted.length > 0) {
            return decrypted[0].name;
        }
        return null;
    } catch (e) {
        console.log('Error desencriptando poll:', e.message);
        return null;
    }
}

async function enviarVideo(sock, remoteJid, videoPath, caption = '') {
    await sock.sendMessage(remoteJid, {
        video: fs.readFileSync(videoPath),
        caption,
    });
    await sleep(1500);
}

async function flujoInicio(sock, remoteJid, nombre) {
    const saludo = nombre ? `Hola ${nombre}! 👋` : 'Hola! 👋';

    await enviarMensaje(sock, remoteJid,
        `${saludo}\n\nTe presento M5-95 — el curso de Meta Ads que te enseña a crear anuncios que venden, desde cero, usando inteligencia artificial 🚀`
    );

    await enviarVideo(sock, remoteJid, path.join(__dirname, 'evidencia.mp4'));

    await enviarMensaje(sock, remoteJid,
        `Con M5-95 vas a lograr:\n🎯 Crear campañas en Meta Ads desde cero\n🎯 Entender por qué un anuncio funciona y otro no\n🎯 Usar IA para optimizar y escalar tus anuncios\n\nMeta Ads no es suerte — es método, estructura y decisiones correctas 💡`
    );

    await enviarMensaje(sock, remoteJid,
        `🔥 Acceso completo por solo S/${PRECIO} soles\n✅ Acceso inmediato\n✅ Acceso de por vida\n✅ Todo organizado por carpetas\n\nCon una sola campaña bien hecha ya recuperas tu inversión 💸`
    );

    await enviarImagen(sock, remoteJid, FLYER_PATH);

    await enviarMensaje(sock, remoteJid,
        `👇 *¿Te lo llevas?*\n\nEscribe *SI* para comprar o *NO* si no deseas por ahora`
    );

    estados[remoteJid] = ESTADO.ESPERANDO_DECISION;
}

async function flujoYape(sock, remoteJid) {
    await enviarMensaje(sock, remoteJid,
        `Perfecto 😊👇\nPara acceder al pack M5-95 JUAN ADS, debes realizar el pago de S/${PRECIO} soles por Yape:\n\n📱 Yape: ${YAPE_NUMERO}\n👤 Titular: ${YAPE_TITULAR}`
    );
    await enviarMensaje(sock, remoteJid,
        `Una vez realizado el pago, envíame por favor:\n✅ El comprobante (captura)\n✅ Tu nombre\n✅ Tu correo electrónico\npara enviarte el acceso inmediato 📩`
    );
    estados[remoteJid] = ESTADO.ESPERANDO_PAGO;
}

async function flujoNoPago(sock, remoteJid) {
    await enviarMensaje(sock, remoteJid,
        `Sin problema! 😊 Cuando estés listo, escríbeme y con gusto te ayudo.\n\nRecuerda que por solo S/${PRECIO} puedes aprender Meta Ads y recuperar tu inversión con una sola campaña 🚀`
    );
    estados[remoteJid] = ESTADO.COMPLETADO;
}

async function flujoAcceso(sock, remoteJid) {
    await enviarMensaje(sock, remoteJid, `¡Bienvenido al mundo de los anuncios colega! 🚀`);
    await enviarMensaje(sock, remoteJid, `Ya quedó registrado tu acceso a M5-95 📚✨\nEn un momento te envío el link con todo el contenido 📂🚀`);
    await sleep(2000);
    await enviarMensaje(sock, remoteJid,
        `Aquí tienes tu acceso completo a M5-95 📚✨\n\nLinks de acceso:\n👉 M5-95 JUAN ADS\n${LINK_CURSO}\n\nRecuerda:\n✅ Acceso inmediato\n✅ Acceso de por vida\n✅ Todo el sistema organizado por carpetas\n\nCualquier duda, me escribes y te ayudo 👍😄`
    );
    estados[remoteJid] = ESTADO.COMPLETADO;
}

async function connectToWhatsApp() {
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
    });

    sockGlobal = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('📱 QR generado! Abre http://localhost:3000');
            qrImageData = await qrcode.toDataURL(qr);
            isConnected = false;
        }
        if (connection === 'close') {
            isConnected = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) setTimeout(() => connectToWhatsApp(), 3000);
        } else if (connection === 'open') {
            isConnected = true;
            qrImageData = '';
            console.log('✅ WhatsApp conectado!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (msg.key.fromMe) continue;
            if (msg.key.remoteJid.includes('@g.us')) continue;

            const remoteJid = msg.key.remoteJid;
            const numero = remoteJid.replace('@s.whatsapp.net', '').replace('@lid', '');
            jidMap[numero] = remoteJid;

            const textoRaw = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
            const texto = textoRaw.toUpperCase();
            const tieneImagen = !!(msg.message?.imageMessage);
            const esPoll = !!(msg.message?.pollUpdateMessage);

            // ── REGISTRO DE ADMIN ──
            // Formato: ADMIN2025 NombreAdmin
            if (texto.startsWith(ADMIN_PASSWORD.toUpperCase())) {
                const partes = textoRaw.split(' ');
                const nombreAdmin = partes.slice(1).join(' ') || 'Admin';
                const keyNombre = nombreAdmin.toLowerCase().replace(/\s+/g, '');
                const envKey = `ADMIN_JID_${Date.now()}${keyNombre}`;
                cargarEnv();
                const adminsActuales = getAdminsJID();
                if (!adminsActuales.includes(remoteJid)) {
                    guardarEnEnv(envKey, remoteJid);
                    console.log(`✅ Admin registrado: ${nombreAdmin} → ${remoteJid}`);
                    await enviarMensaje(sock, remoteJid, `✅ Registrado como admin, ${nombreAdmin}!`);
                } else {
                    await enviarMensaje(sock, remoteJid, `ℹ️ Ya estás registrado como admin, ${nombreAdmin}.`);
                }
                continue;
            }

            // ── RESET DE FLUJO ──
            if (texto === PALABRA_RESET.toUpperCase()) {
                delete estados[remoteJid];
                await enviarMensaje(sock, remoteJid, '🔄 Flujo reiniciado!');
                continue;
            }

            // ── COMANDOS DE ADMINS ──
            if (texto === 'ADMINS LISTA') {
                const admins = getAdminsJID();
                const envContent = fs.readFileSync(envPath, 'utf8');
                const lineas = envContent.split('\n').filter(l => l.startsWith('ADMIN_JID_'));
                if (lineas.length === 0) {
                    await enviarMensaje(sock, remoteJid, '⚠️ No hay admins registrados.');
                } else {
                    const lista = lineas.map((l, i) => {
                        const [key, jid] = l.split('=');
                        const nombre = key.replace('ADMIN_JID_', '').replace(/[0-9]/g, '').trim();
                        return `${i + 1}. ${nombre || 'Admin'} → ${jid}`;
                    }).join('\n');
                    await enviarMensaje(sock, remoteJid, `📋 *Admins registrados:*\n\n${lista}`);
                }
                continue;
            }

            if (texto.startsWith('ADMINS BORRAR ')) {
                const buscar = textoRaw.replace(/ADMINS BORRAR /i, '').trim().toLowerCase();
                let envContent = fs.readFileSync(envPath, 'utf8');
                const lineas = envContent.split('\n');
                const nuevasLineas = lineas.filter(l => {
                    if (!l.startsWith('ADMIN_JID_')) return true;
                    const [key, jid] = l.split('=');
                    const nombre = key.replace('ADMIN_JID_', '').replace(/[0-9]/g, '').trim().toLowerCase();
                    return !nombre.includes(buscar) && !jid?.includes(buscar);
                });
                fs.writeFileSync(envPath, nuevasLineas.join('\n'));
                // Recargar env
                cargarEnv();
                await enviarMensaje(sock, remoteJid, `✅ Admin *${buscar}* eliminado!`);
                continue;
            }

            // ── ADMIN APROBANDO O RECHAZANDO ──
            const adminsJID = getAdminsJID();
            const esAdmin = adminsJID.includes(remoteJid);

            if (esAdmin && (texto === 'OK' || texto === 'NO')) {
                // Detectar a qué pago responde (por mensaje citado)
                const msgIdCitado = msg.message?.extendedTextMessage?.contextInfo?.stanzaId || null;
                let pendiente = null;

                if (msgIdCitado && pagosEsperando[msgIdCitado]) {
                    pendiente = [msgIdCitado, pagosEsperando[msgIdCitado]];
                } else {
                    // Si no respondió a ninguno, toma el primero pendiente
                    const entries = Object.entries(pagosEsperando);
                    if (entries.length > 0) pendiente = entries[0];
                }

                if (pendiente) {
                    const [msgId, data] = pendiente;
                    delete pagosEsperando[msgId];
                    if (texto === 'OK') {
                        console.log(`✅ Pago aprobado para ${data.clienteJid}`);
                        await enviarMensaje(sock, remoteJid, `✅ Acceso enviado al cliente!`);
                        await flujoAcceso(sock, data.clienteJid);
                    } else {
                        console.log(`❌ Pago rechazado para ${data.clienteJid}`);
                        estados[data.clienteJid] = ESTADO.ESPERANDO_PAGO;
                        await enviarMensaje(sock, remoteJid, `❌ Pago rechazado, cliente notificado.`);
                        await enviarMensaje(sock, data.clienteJid,
                            `Lo sentimos, no pudimos verificar tu pago 😕\nPor favor envía nuevamente el comprobante claro y completo 📸`
                        );
                    }
                } else {
                    await enviarMensaje(sock, remoteJid, `⚠️ No hay pagos pendientes por aprobar.`);
                }
                continue;
            }

            if (esAdmin) continue; // Admin escribió otra cosa, ignorar

            // ── FLUJO DE CLIENTE ──
            const estadoActual = estados[remoteJid] || ESTADO.INICIO;
            console.log(`📨 [${estadoActual}] Mensaje de ${numero}: ${textoRaw || (tieneImagen ? '[imagen]' : '[poll]')}`);

            if (estadoActual === ESTADO.INICIO) {
                await flujoInicio(sock, remoteJid, msg.pushName || '');
                continue;
            }

            if (estadoActual === ESTADO.ESPERANDO_DECISION) {
                const buttonId = msg.message?.buttonsResponseMessage?.selectedButtonId || '';
                const quiereComprar = /^(si|sí|s|1|siii+|si quiero|si deseo|quiero|deseo|dale|ya|ok|claro|obvio)/i.test(textoRaw);
                const noQuiere = /^(no|n|2|nel|nop|no quiero|no deseo|no por ahora)/i.test(textoRaw);
                if (buttonId === 'COMPRAR' || quiereComprar) {
                    await flujoYape(sock, remoteJid);
                } else if (buttonId === 'NO_COMPRAR' || noQuiere) {
                    await flujoNoPago(sock, remoteJid);
                } else {
                    await enviarMensaje(sock, remoteJid, '👇 *RESPONDE AQUÍ* 👇\n\n✅ Escribe *SI* para comprar\n❌ Escribe *NO* si no deseas por ahora');
                }
                continue;
            }

            if (tieneImagen && estadoActual === ESTADO.ESPERANDO_PAGO) {
                estados[remoteJid] = ESTADO.VALIDANDO_PAGO;
                const msgId = msg.key.id;
                pagosEsperando[msgId] = { clienteJid: remoteJid, nombre: msg.pushName || numero };

                await enviarMensaje(sock, remoteJid,
                    `✅ Recibimos tu comprobante!\nEstamos verificando tu pago, en un momento te damos acceso 🔄`
                );

                try {
                    console.log('📸 Descargando comprobante...');
                    const buffer = await downloadMediaMessage(
                        msg,
                        'buffer',
                        {},
                        { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
                    );
                    console.log('📸 Imagen lista, tamaño:', buffer.length);

                    const admins = getAdminsJID();
                    for (const adminJid of admins) {
                        await sock.sendMessage(adminJid, {
                            image: buffer,
                            caption: `💰 Pago de ${msg.pushName || numero} (${numero})\n\nResponde a *este mensaje* con:\n✅ *OK* para aprobar\n❌ *NO* para rechazar`,
                        }, { quoted: { key: { id: msgId, remoteJid: adminJid, fromMe: false }, message: { imageMessage: msg.message.imageMessage } } });
                    }
                } catch (e) {
                    console.error('❌ Error enviando comprobante:', e.message);
                    const admins = getAdminsJID();
                    for (const adminJid of admins) {
                        await enviarMensaje(sock, adminJid,
                            `💰 Pago de ${msg.pushName || numero} (${numero}) - no se pudo reenviar imagen\nResponde *OK* para aprobar o *NO* para rechazar`
                        );
                    }
                }
                continue;
            }

            if (estadoActual === ESTADO.VALIDANDO_PAGO) {
                await enviarMensaje(sock, remoteJid, `⏳ Ya recibimos tu comprobante, estamos verificando. Un momento...`);
                continue;
            }

            if (estadoActual === ESTADO.COMPLETADO) {
                await enviarMensaje(sock, remoteJid, `Hola! Ya tienes acceso al curso 😊\nCualquier duda escríbeme y te ayudo 👍`);
                continue;
            }
        }
    });

    return sock;
}
if (process.env.RESET_SESSION === 'true') {
    if (fs.existsSync('auth_info')) {
        fs.rmSync('auth_info', { recursive: true });
        console.log('🗑️ Sesión borrada, escanea el QR');
    }
}

connectToWhatsApp();