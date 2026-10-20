/**
 * Verificador de la regla de dependencias del monorepo.
 *
 * Reglas:
 *   1. El paquete dominio no importa nada externo salvo tipos de Node.
 *   2. El dominio nunca importa React, Express ni node:sqlite.
 *   3. Dentro de backend y frontend, las capas apuntan hacia adentro.
 *
 * Sin comprobación automática la regla se rompe en la primera urgencia.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const PERMITIDO = {
  aplicacion: ["aplicacion", "dominio"],
  infraestructura: ["infraestructura", "aplicacion", "dominio"],
  ui: ["ui", "dominio", "infraestructura"],
};

const PROHIBIDO_EN_DOMINIO = [/from ["']react/, /from ["']express/, /from ["']node:sqlite/];

function* archivos(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === "dist") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* archivos(p);
    else if (/\.tsx?$/.test(e)) yield p;
  }
}

let fallos = 0, revisados = 0;

// Regla 1 y 2: pureza del dominio
for (const f of archivos("dominio/src")) {
  revisados++;
  const t = readFileSync(f, "utf8");
  for (const re of PROHIBIDO_EN_DOMINIO)
    if (re.test(t)) {
      console.error(`  ✗ ${f} importa un framework. El dominio debe ser puro.`);
      fallos++;
    }
  for (const m of t.matchAll(/from ["']([^"']+)["']/g))
    if (!m[1].startsWith(".")) {
      console.error(`  ✗ ${f} importa el paquete externo ${m[1]}.`);
      fallos++;
    }
}

// Regla 3: capas internas de backend y frontend
for (const paquete of ["backend/src", "frontend/src"]) {
  for (const f of archivos(paquete)) {
    const capa = relative(paquete, f).split("/")[0];
    if (!PERMITIDO[capa]) continue;
    revisados++;
    const t = readFileSync(f, "utf8");
    for (const m of t.matchAll(/from ["'](\.[^"']+)["']/g)) {
      const partes = f.split("/").slice(0, -1);
      for (const seg of m[1].split("/")) {
        if (seg === "..") partes.pop();
        else if (seg !== ".") partes.push(seg);
      }
      const destino = relative(paquete, partes.join("/")).split("/")[0];
      if (destino === capa || !PERMITIDO[destino]) continue;
      if (!PERMITIDO[capa].includes(destino)) {
        console.error(`  ✗ ${f}\n      «${capa}» no puede depender de «${destino}»`);
        fallos++;
      }
    }
  }
}

console.log(fallos === 0
  ? `\n  Regla de dependencias respetada en ${revisados} archivos.\n`
  : `\n  ${fallos} violación(es).\n`);
process.exit(fallos === 0 ? 0 : 1);
