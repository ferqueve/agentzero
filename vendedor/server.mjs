// VENDEDOR: agente que ofrece tres servicios pagos a otros agentes,
// cobrando en USDC real sobre Base (mainnet) mediante el protocolo x402.
//
// Servicios:
//   POST /servicio/generar-qr        $0.003  -> texto/URL a código QR (PNG)
//   POST /servicio/markdown-a-html   $0.0025 -> Markdown a HTML
//   POST /servicio/formatear-json    $0.002  -> valida y prolija un JSON
//
// Los precios quedan con margen por encima del mínimo que exige el
// facilitador (~$0.0015 por cobro en Base); por debajo de eso, rechaza
// directamente el pago.
//
// No usa ninguna clave de API externa: todo corre con librerías locales
// (qrcode, marked), así que el único costo de operar este servicio es el
// del hosting.

import "dotenv/config";
import express from "express";
import QRCode from "qrcode";
import { marked } from "marked";
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
    ],
  });
});

app.listen(PORT, () => {
  console.log(`Vendedor escuchando en el puerto ${PORT}`);
  console.log(`Red: ${RED} | Facilitador: ${FACILITATOR_URL}`);
  console.log(`Recibe los pagos en: ${EVM_ADDRESS}`);
});