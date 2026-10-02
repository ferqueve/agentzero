// COMPRADOR: un agente que le paga automáticamente al VENDEDOR por uno de
// sus tres servicios, sin intervención humana, cada vez que lo necesita.
//
// Es una herramienta de testing para probar el servicio ya desplegado,
// usando un poquito de USDC real en Base.
//
// Tiene dos frenos de seguridad:
// 1) Tope por llamada (spendControls): nunca paga más de $0.01 de una vez.
// 2) Presupuesto diario (control propio, en presupuesto.json): si ya gastó
//    el máximo del día, se niega a seguir pagando aunque el servicio se lo pida.
//
// Uso:
//   node client.mjs qr "https://ejemplo.com"
//   node client.mjs markdown "# Hola\n\nEsto es **Markdown**"
//   node client.mjs json '{"a":1,"b":2}'

import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";

const VENDEDOR_URL = process.env.VENDEDOR_URL || "http://localhost:4021";
const PRESUPUESTO_DIARIO_USD = Number(process.env.PRESUPUESTO_DIARIO_USD || 0.05);
const TOPE_POR_LLAMADA_USD = process.env.TOPE_POR_LLAMADA_USD || "$0.01";
const ARCHIVO_PRESUPUESTO = new URL("./presupuesto.json", import.meta.url);

const SERVICIOS = {
  qr: { ruta: "/servicio/generar-qr", campo: "texto" },
  markdown: { ruta: "/servicio/markdown-a-html", campo: "markdown" },
  json: { ruta: "/servicio/formatear-json", campo: "json" },
};

if (!process.env.EVM_PRIVATE_KEY) {
  console.error(
    "Falta EVM_PRIVATE_KEY en comprador/.env. Corré primero: node generar-wallet-comprador.mjs",
  );
  process.exit(1);
}

const [servicioPedido, ...resto] = process.argv.slice(2);
const servicio = SERVICIOS[servicioPedido];

if (!servicio) {
  console.error(
    `Uso: node client.mjs <qr|markdown|json> "contenido"\n` +
      `Ejemplo: node client.mjs qr "https://ejemplo.com"`,
  );
  process.exit(1);
}

const contenido = resto.join(" ");

// --- Control de presupuesto diario, guardado en un archivo local ---

function leerPresupuestoDeHoy() {
  const hoy = new Date().toISOString().slice(0, 10); // AAAA-MM-DD

  if (existsSync(ARCHIVO_PRESUPUESTO)) {
    const datos = JSON.parse(readFileSync(ARCHIVO_PRESUPUESTO, "utf8"));
    if (datos.fecha === hoy) return datos;
  }

  return { fecha: hoy, gastadoUsd: 0, pagos: 0 };
}

function guardarPresupuesto(datos) {
  writeFileSync(ARCHIVO_PRESUPUESTO, JSON.stringify(datos, null, 2));
}

function atomicoAUsd(montoAtomico) {
  // USDC tiene 6 decimales en Base.
  return Number(montoAtomico) / 1_000_000;
}

// --- Armado del agente comprador ---

const signer = privateKeyToAccount(process.env.EVM_PRIVATE_KEY);

const client = x402Client.fromConfig({
  schemes: [{ network: "eip155:*", client: new ExactEvmScheme(signer) }],
  spendControls: {
    maxAmountPerPayment: TOPE_POR_LLAMADA_USD,
  },
});

// Antes de firmar cualquier pago, revisa si ya se pasó del presupuesto diario.
client.onBeforePaymentCreation(async (context) => {
  const montoUsd = atomicoAUsd(context.selectedRequirements.amount);
  const presupuesto = leerPresupuestoDeHoy();

  if (presupuesto.gastadoUsd + montoUsd > PRESUPUESTO_DIARIO_USD) {
    return {
      abort: true,
      reason: `Presupuesto diario agotado: ya gastó $${presupuesto.gastadoUsd.toFixed(
        4,
      )} de $${PRESUPUESTO_DIARIO_USD} hoy.`,
    };
  }
});

const fetchConPago = wrapFetchWithPayment(fetch, client);
const httpClient = new x402HTTPClient(client);

// --- Hacer el pedido pago ---

async function pedirServicio() {
  console.log(`Pidiendo "${servicioPedido}" y pagando automáticamente si hace falta...`);

  const respuesta = await fetchConPago(`${VENDEDOR_URL}${servicio.ruta}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [servicio.campo]: contenido }),
  });

  const resultado = await httpClient.processResponse(respuesta);

  if (resultado.paymentStatus === "settled") {
    const montoUsd = atomicoAUsd(resultado.header?.amount ?? 0);
    const presupuesto = leerPresupuestoDeHoy();
    presupuesto.gastadoUsd += montoUsd;
    presupuesto.pagos += 1;
    guardarPresupuesto(presupuesto);

    console.log(`Pago liquidado: $${montoUsd.toFixed(4)}`);
    console.log(
      `Gastado hoy: $${presupuesto.gastadoUsd.toFixed(4)} de $${PRESUPUESTO_DIARIO_USD} (${presupuesto.pagos} llamadas)`,
    );
  } else if (resultado.paymentStatus === "settle_failed") {
    console.error("El pago falló al liquidarse:", resultado.header);
  }

  console.log("Respuesta del servicio:", resultado.body);
}

try {
  await pedirServicio();
} catch (error) {
  if (String(error.message).includes("Presupuesto diario agotado")) {
    console.error("No se hizo el pago:", error.message);
  } else {
    console.error("Error al pedir el servicio:", error.message);
  }
  process.exit(1);
}
