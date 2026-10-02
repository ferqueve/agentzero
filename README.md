# Agente vendedor x402

Un servicio que otros agentes de IA pueden usar y pagar automáticamente,
en USDC real sobre Base (mainnet), usando el protocolo
[x402](https://docs.x402.org).

Ofrece tres servicios, cada uno con precio fijo:

| Servicio | Ruta | Precio |
|---|---|---|
| Generar un código QR a partir de un texto o URL | `POST /servicio/generar-qr` | $0.002 |
| Convertir Markdown a HTML | `POST /servicio/markdown-a-html` | $0.001 |
| Validar y prolijar un JSON | `POST /servicio/formatear-json` | $0.0005 |

No usa ninguna clave de API externa — las tres tareas se resuelven con
librerías locales (`qrcode`, `marked`). El único costo de operarlo es el
del hosting (podés quedarte en el plan gratuito).

También incluye, en `comprador/`, un agente de prueba que paga el servicio
automáticamente, para validar que todo funciona de punta a punta.

## Estructura

```
vendedor/    el servicio que se despliega y queda corriendo 24/7
comprador/   herramienta de testing: le paga al servicio desplegado
```

## 1. Desplegar el vendedor en Render

### Antes de nada: conseguí una dirección para recibir los pagos

Necesitás la **dirección pública** de una billetera en Base (mainnet).
Creala en una wallet real que vos controles — MetaMask, Coinbase Wallet,
Rabby, o la que uses — y asegurate de tenerla configurada en la red **Base**
(no Ethereum mainnet, no Base Sepolia). No hace falta la clave privada para
nada de esto: el servicio solo recibe pagos, nunca los firma.

Guardá esa dirección (algo como `0xAbC123...`), la vas a necesitar en el
paso 3.

### Paso 1: subir el código a GitHub

```bash
git init
git add .
git commit -m "Agente vendedor x402: QR, Markdown a HTML, formateo de JSON"
git remote add origin https://github.com/ferqueve/TU-REPO.git
git push -u origin main
```

(Si el repo lo creaste vacío desde GitHub, puede que la rama por defecto
sea `main` o `master` — ajustá el último comando según corresponda.)

### Paso 2: crear el servicio en Render

1. Entrá a [render.com](https://render.com) y creá una cuenta (podés
   entrar con tu cuenta de GitHub).
2. **New** → **Web Service**.
3. Elegí el repositorio que acabás de subir.
4. Completá:
   - **Root Directory**: `vendedor`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free

### Paso 3: configurar las variables de entorno

En la sección **Environment** del servicio, agregá:

| Variable | Valor |
|---|---|
| `EVM_ADDRESS` | la dirección que conseguiste al principio |
| `FACILITATOR_URL` | `https://dexter.cash/facilitator` (podés dejarla así, es el valor por defecto) |

Render define `PORT` automáticamente, no hace falta que la agregues.

### Paso 4: desplegar

Guardá los cambios — Render va a instalar las dependencias y arrancar el
servicio solo. Cuando termine, vas a tener una URL pública como
`https://agente-vendedor.onrender.com`. Entrando a esa URL en el navegador
deberías ver un JSON describiendo los tres servicios.

**Nota sobre el plan gratuito:** Render "duerme" el servicio después de 15
minutos sin tráfico, y tarda unos segundos en despertar con el primer
pedido que llega. Para un servicio que recién arranca no es grave; si más
adelante ves que esto te hace perder clientes, Render tiene planes pagos
que no duermen.

## 2. Probar que funciona, con un poquito de plata real

Desde tu computadora (no hace falta que sea en este mismo entorno):

```bash
cd comprador
npm install
node generar-wallet-comprador.mjs
```

Esto te da una dirección nueva. Cargale un dólar de USDC real en Base
(con eso alcanza para cientos de pruebas a estos precios). En general no
hace falta cargarle también ETH para el gas, porque quien transmite el
pago es el facilitador, no esta billetera — pero si al probar te pide gas
igual, cargále también un par de dólares de ETH en Base.

Editá `comprador/.env` y poné la URL real de tu servicio en Render:

```
VENDEDOR_URL=https://agente-vendedor.onrender.com
```

Y probá cada servicio:

```bash
node client.mjs qr "https://ejemplo.com"
node client.mjs markdown "# Hola\n\nEsto es **Markdown**"
node client.mjs json '{"a":1,"b":2}'
```

Si todo sale bien, vas a ver el pago liquidado y la respuesta del servicio.
Fijate también que te llegó el pago a tu billetera receptora (podés
chequearlo en [basescan.org](https://basescan.org) buscando la dirección).

## Los dos frenos de seguridad del comprador

- **Tope por llamada** (`TOPE_POR_LLAMADA_USD`, por defecto $0.01): x402 no
  deja pagar más que esto de una vez, pase lo que pase.
- **Presupuesto diario** (`PRESUPUESTO_DIARIO_USD`, por defecto $0.05): lo
  controla el propio script, sumando lo gastado en `presupuesto.json`.

Esto es para cuando *vos* seas comprador. El servicio que desplegás
(`vendedor/`) no gasta nada — solo cobra.

## Cómo seguir desde acá

Con el servicio desplegado y probado, lo que falta es que otros agentes lo
encuentren. Algunas pistas, para ir probando y viendo qué da resultado:

- **Bazaar de x402**: es el directorio donde los agentes buscan servicios
  pagos para contratar. La documentación explica cómo publicar ahí
  (`docs.x402.org/extensions/bazaar`).
- **Moltbook y comunidades similares de agentes**: contar ahí qué servicio
  ofrecés, en los términos que use esa comunidad.
- **Como servidor MCP**: algunos agentes buscan herramientas por MCP antes
  que por HTTP directo; x402 tiene soporte para eso (`@x402/mcp`).

Y llevá un registro simple de qué pasa: cuántas llamadas te llegan, a qué
servicio, y si el pago se liquida bien. Con eso como feedback real, se
puede decidir si conviene ajustar precios, cambiar de servicio, o sumar
uno nuevo.
