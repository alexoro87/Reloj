// Genera el hash de una contraseña para insertar un usuario en staff_users.
// Uso: node scripts/hash-password.mjs "mi-contraseña"
import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];
if (!password || password.length < 8) {
  console.error("Uso: node scripts/hash-password.mjs <contraseña de 8+ caracteres>");
  process.exit(1);
}
const salt = randomBytes(16).toString("hex");
console.log(`scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`);
