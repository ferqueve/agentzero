// Genera una billetera de prueba para el COMPRADOR (el que paga), para
// poder probar el servicio ya desplegado con un poquito de plata real.
//
// La billetera del VENDEDOR (la que recibe los pagos) NO se genera acá:
// esa te conviene crearla vos mismo en una wallet real (MetaMask, Coinbase
// Wallet, Rabby, etc.) en la red Base, porque es la que vas a usar para
// retirar lo que vayas cobrando. Esta billetera del comprador, en cambio,
// es solo una herramienta de testing de tu lado, de bajo riesgo.
//
// Uso: node generar-wallet-comprador.mjs

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { writeFileSync, existsSync } from "node:fs";

if (existsSync(new URL("./.env", import.meta.url))) {
  console.error(
    "Ya existe comprador/.env. Si querés generar una billetera nueva, " +
      "primero hacé una copia de seguridad o borrá ese archivo a mano.",
  );
  process.exit(1);
}

const clavePrivada = generatePrivateKey();
const cuenta = privateKeyToAccount(clavePrivada);

console.log("=== Billetera de prueba del COMPRADOR ===");
console.log("Dirección:    ", cuenta.address);
console.log("Clave privada:", clavePrivada);
console.log();

writeFileSync(
  ".env",
  `# Base mainnet — billetera de prueba del comprador, cargala con poca plata\n` +
    `EVM_PRIVATE_KEY=${clavePrivada}\n` +
    `VENDEDOR_URL=https://tu-servicio.onrender.com\n`,
);

console.log("Se creó comprador/.env con esta clave.");
console.log();
console.log("Próximo paso: cargar esta dirección con un poco de USDC real en Base");
console.log(`(con $1 alcanza para cientos de pruebas): ${cuenta.address}`);
console.log();
console.log(
  "En general no hace falta cargarle ETH: quien transmite el pago es el " +
    "facilitador, no esta billetera. Si al probar te pide gas igual, " +
    "cargále también un par de dólares de ETH en Base.",
);
