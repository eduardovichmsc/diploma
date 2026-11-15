/**
 * Встроенный MQTT-брокер для разработки без Docker (замена Mosquitto).
 *   npm run broker
 */
import { createServer } from 'net';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const aedes = require('aedes')();

const port = Number(process.env.MQTT_PORT ?? 1883);
const server = createServer(aedes.handle);

server.listen(port, () => console.log(`MQTT-брокер (aedes) слушает порт ${port}`));

aedes.on('client', (c: { id: string }) => console.log(`+ клиент ${c.id}`));
aedes.on('clientDisconnect', (c: { id: string }) => console.log(`- клиент ${c.id}`));
