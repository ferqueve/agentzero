// VENDEDOR: agente que ofrece seis servicios pagos a otros agentes,
// cobrando en USDC real sobre Base (mainnet) mediante el protocolo x402.
//
// Servicios:
//   POST /servicio/generar-qr          $0.003  -> texto/URL a código QR (PNG)
//   POST /servicio/markdown-a-html     $0.0025 -> Markdown a HTML
//   POST /servicio/formatear-json      $0.002  -> valida y prolija un JSON
//   POST /servicio/detectar-drift      $0.0025 -> diferencias entre dos JSON (config esperada vs real)
//   POST /servicio/verificar-hash      $0.002  -> compara el hash SHA-256 de un contenido contra uno esperado
//   POST /servicio/validar-direccion-evm $0.002 -> valida formato y checksum (EIP-55) de una dirección 0x...
//
// Los precios quedan con margen por encima del mínimo que exige el
// facilitador (~$0.0015 por cobro en Base); por debajo de eso, rechaza
// directamente el pago.
//
// No usa ninguna clave de API externa: todo corre con librerías locales
// (qrcode, marked, viem, crypto nativo de Node), así que el único costo
// de operar este servicio es el del hosting.

import "dotenv/config";
import { createHash } from "node:crypto";
import express from "express";
import QRCode from "qrcode";
import { marked } from "marked";
import { isAddress, getAddress } from "viem";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const PORT = process.env.PORT || 4021;
const EVM_ADDRESS = process.env.EVM_ADDRESS;

if (!EVM_ADDRESS) {
  console.error(
    "Falta la variable de entorno EVM_ADDRESS: la dirección (pública) de la " +
      "billetera que va a recibir los pagos. No hace falta la clave privada " +
      "para este servicio, solo la dirección.",
  );
  process.exit(1);
}

const RED = "eip155:8453"; // Base mainnet

// Facilitador público, gratuito, sin necesidad de cuenta y que paga el gas
// por nosotros. Ojo: esta es la URL real de la API (no la de marketing,
// que es solo "dexter.cash/facilitator").
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://x402.dexter.cash";

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

const servidorDePagos = new x402ResourceServer(facilitatorClient).register(
  RED,
  new ExactEvmScheme(),
);

const app = express();
app.use(express.json({ limit: "256kb" }));

function requisitoDePago(precio, descripcion, mimeType) {
  return {
    accepts: [{ scheme: "exact", price: precio, network: RED, payTo: EVM_ADDRESS }],
    description: descripcion,
    mimeType,
  };
}

app.use(
  paymentMiddleware(
    {
      "POST /servicio/generar-qr": requisitoDePago(
        "$0.003",
        "Genera un código QR (PNG en base64) a partir de un texto o URL",
        "application/json",
      ),
      "POST /servicio/markdown-a-html": requisitoDePago(
        "$0.0025",
        "Convierte texto en formato Markdown a HTML",
        "application/json",
      ),
      "POST /servicio/formatear-json": requisitoDePago(
        "$0.002",
        "Valida un JSON y devuelve la versión prolija e indentada",
        "application/json",
      ),
      "POST /servicio/detectar-drift": requisitoDePago(
        "$0.0025",
        "Compara dos JSON (configuración esperada vs. real) y devuelve las diferencias exactas",
        "application/json",
      ),
      "POST /servicio/verificar-hash": requisitoDePago(
        "$0.002",
        "Calcula el hash SHA-256 de un contenido y confirma si coincide con el hash esperado",
        "application/json",
      ),
      "POST /servicio/validar-direccion-evm": requisitoDePago(
        "$0.002",
        "Valida el formato y el checksum (EIP-55) de una dirección de wallet EVM (0x...)",
        "application/json",
      ),
    },
    servidorDePagos,
  ),
);

// --- Servicio 1: generar código QR ---
app.post("/servicio/generar-qr", async (req, res) => {
  const texto = req.body?.texto;

  if (!texto || typeof texto !== "string") {
    return res.status(400).json({ error: "Falta el campo 'texto' (string) en el cuerpo del pedido" });
  }

  try {
    const pngBase64 = await QRCode.toDataURL(texto, { margin: 1, width: 300 });
    res.json({ resultado: { formato: "png-base64", imagen: pngBase64 } });
  } catch (error) {
    res.status(422).json({ error: "No se pudo generar el código QR", detalle: error.message });
  }
});

// --- Servicio 2: Markdown a HTML ---
app.post("/servicio/markdown-a-html", async (req, res) => {
  const markdown = req.body?.markdown;

  if (!markdown || typeof markdown !== "string") {
    return res.status(400).json({ error: "Falta el campo 'markdown' (string) en el cuerpo del pedido" });
  }

  try {
    const html = await marked.parse(markdown);
    res.json({ resultado: { html } });
  } catch (error) {
    res.status(422).json({ error: "No se pudo convertir el Markdown", detalle: error.message });
  }
});

// --- Servicio 3: formatear y validar JSON ---
app.post("/servicio/formatear-json", (req, res) => {
  const json = req.body?.json;

  if (json === undefined || typeof json !== "string") {
    return res.status(400).json({ error: "Falta el campo 'json' (string) en el cuerpo del pedido" });
  }

  try {
    const objeto = JSON.parse(json);
    res.json({ resultado: { valido: true, formateado: JSON.stringify(objeto, null, 2) } });
  } catch (error) {
    res.json({ resultado: { valido: false, error: error.message } });
  }
});

// --- Servicio 4: detectar drift entre dos JSON (config esperada vs. real) ---
function diferenciasEntreObjetos(esperado, real, prefijo = "") {
  const diferencias = [];

  const esObjeto = (valor) =>
    typeof valor === "object" && valor !== null && !Array.isArray(valor);

  const clavesEsperado = new Set(Object.keys(esperado || {}));
  const clavesReal = new Set(Object.keys(real || {}));
  const todasLasClaves = new Set([...clavesEsperado, ...clavesReal]);

  for (const clave of todasLasClaves) {
    const ruta = prefijo ? `${prefijo}.${clave}` : clave;
    const estaEnEsperado = clavesEsperado.has(clave);
    const estaEnReal = clavesReal.has(clave);

    if (!estaEnReal) {
      diferencias.push({ ruta, tipo: "faltante_en_real", valorEsperado: esperado[clave] });
      continue;
    }

    if (!estaEnEsperado) {
      diferencias.push({ ruta, tipo: "sobra_en_real", valorReal: real[clave] });
      continue;
    }

    const valorEsperado = esperado[clave];
    const valorReal = real[clave];

    if (esObjeto(valorEsperado) && esObjeto(valorReal)) {
      diferencias.push(...diferenciasEntreObjetos(valorEsperado, valorReal, ruta));
    } else if (JSON.stringify(valorEsperado) !== JSON.stringify(valorReal)) {
      diferencias.push({ ruta, tipo: "valor_distinto", esperado: valorEsperado, real: valorReal });
    }
  }

  return diferencias;
}

app.post("/servicio/detectar-drift", (req, res) => {
  const { esperado, real } = req.body || {};

  if (typeof esperado !== "object" || esperado === null || Array.isArray(esperado)) {
    return res.status(400).json({ error: "Falta el campo 'esperado' (objeto JSON) en el cuerpo del pedido" });
  }

  if (typeof real !== "object" || real === null || Array.isArray(real)) {
    return res.status(400).json({ error: "Falta el campo 'real' (objeto JSON) en el cuerpo del pedido" });
  }

  const diferencias = diferenciasEntreObjetos(esperado, real);

  res.json({
    resultado: {
      hayDrift: diferencias.length > 0,
      cantidadDiferencias: diferencias.length,
      diferencias,
    },
  });
});

// --- Servicio 5: verificar hash SHA-256 ---
app.post("/servicio/verificar-hash", (req, res) => {
  const contenido = req.body?.contenido;
  const hashEsperado = req.body?.hashEsperado;

  if (typeof contenido !== "string") {
    return res.status(400).json({ error: "Falta el campo 'contenido' (string) en el cuerpo del pedido" });
  }

  if (typeof hashEsperado !== "string" || !hashEsperado) {
    return res.status(400).json({ error: "Falta el campo 'hashEsperado' (string) en el cuerpo del pedido" });
  }

  const hashCalculado = createHash("sha256").update(contenido, "utf8").digest("hex");
  const coincide = hashCalculado.toLowerCase() === hashEsperado.trim().toLowerCase();

  res.json({
    resultado: { algoritmo: "sha256", hashCalculado, hashEsperado, coincide },
  });
});

// --- Servicio 6: validar dirección EVM (formato + checksum EIP-55) ---
app.post("/servicio/validar-direccion-evm", (req, res) => {
  const direccion = req.body?.direccion;

  if (typeof direccion !== "string" || !direccion) {
    return res.status(400).json({ error: "Falta el campo 'direccion' (string) en el cuerpo del pedido" });
  }

  const formatoValido = isAddress(direccion, { strict: false });

  if (!formatoValido) {
    return res.json({
      resultado: { valida: false, motivo: "No tiene el formato de una dirección EVM (0x + 40 hex)" },
    });
  }

  const checksumCorrecto = isAddress(direccion, { strict: true });
  const direccionConChecksum = getAddress(direccion);

  res.json({
    resultado: {
      valida: true,
      checksumCorrecto,
      direccionConChecksumCorrecto: direccionConChecksum,
    },
  });
});

// --- Página informativa (gratis, sin pago) ---
app.get("/", (_req, res) => {
  res.json({
    servicio: "Agente vendedor x402",
    red: RED,
    recibePagosEn: EVM_ADDRESS,
    servicios: [
      { ruta: "POST /servicio/generar-qr", precio: "$0.003" },
      { ruta: "POST /servicio/markdown-a-html", precio: "$0.0025" },
      { ruta: "POST /servicio/formatear-json", precio: "$0.002" },
      { ruta: "POST /servicio/detectar-drift", precio: "$0.0025" },
      { ruta: "POST /servicio/verificar-hash", precio: "$0.002" },
      { ruta: "POST /servicio/validar-direccion-evm", precio: "$0.002" },
    ],
  });
});

app.listen(PORT, () => {
  console.log(`Vendedor escuchando en el puerto ${PORT}`);
  console.log(`Red: ${RED} | Facilitador: ${FACILITATOR_URL}`);
  console.log(`Recibe los pagos en: ${EVM_ADDRESS}`);
});
