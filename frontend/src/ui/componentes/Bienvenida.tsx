/**
 * FoodLoop · Pantalla de propósito
 *
 * Se muestra una sola vez por usuario, al entrar, y responde dos
 * preguntas antes de que el usuario toque nada: qué hace esto y qué se
 * espera de mí.
 *
 * Por qué existe: en la evaluación con usuarios, la brecha más grande
 * no estuvo entre perfiles sino entre quienes usan sistemas
 * informáticos a diario (media 4.46 sobre 5) y quienes los usan a
 * veces (3.55). Uno de ellos escribió que lo más confuso fue «entender
 * el propósito»: no le costó manejar la pantalla, le faltó saber para
 * qué servía. Un panel de contexto al entrar es la respuesta barata a
 * ese hallazgo.
 *
 * Se recuerda en el navegador para no estorbar a quien ya la leyó, y
 * queda accesible desde la barra superior para quien quiera repasarla.
 */

import type { Rol } from "@foodloop/dominio";
import { Icono } from "./UI";

/** Qué se espera de cada perfil, en su propio lenguaje. */
const ESPERADO: Record<Rol, string> = {
  chef:
    "Usted elige los lotes y decide qué se produce. El sistema propone y "
    + "explica por qué, pero la decisión y la responsabilidad sobre el "
    + "alimento siguen siendo suyas.",
  produccion:
    "Usted elige los lotes, decide qué se produce y ve el valor que se "
    + "recupera. El sistema propone y explica por qué; la decisión es suya.",
  admin:
    "Usted consulta las propuestas y el valor recuperado para seguimiento "
    + "y reportes. La aprobación de lo que se cocina la hace el personal de "
    + "cocina, no este perfil.",
  calidad:
    "Usted emite el dictamen sanitario, que es la única restricción que el "
    + "sistema nunca pasa por alto. Si usted bloquea un lote, ninguna "
    + "propuesta lo usará.",
};

const PASOS = [
  { icono: "box", texto: "Registre la merma del servicio o elija lotes ya registrados." },
  { icono: "chispa", texto: "El sistema propone preparaciones y explica por qué cada una." },
  { icono: "check", texto: "Usted aprueba, modifica o descarta. Lo que decida queda guardado." },
] as const;

export default function Bienvenida(
  { rol, nombre, onCerrar }: { rol: Rol; nombre: string; onCerrar: () => void },
) {
  return (
    <div className="velo" role="dialog" aria-modal="true"
      aria-labelledby="bienvenida-titulo">
      <div className="bienvenida">
        <button className="cerrar" onClick={onCerrar} aria-label="Cerrar">
          <Icono n="x" s={16} />
        </button>

        <span className="rotulo">Antes de empezar</span>
        <h2 id="bienvenida-titulo">Qué hace FoodLoop</h2>

        <p className="b-texto">
          Al terminar cada servicio queda comida preparada que no se sirvió.
          FoodLoop revisa esos lotes y propone preparaciones que los
          aprovechan <b>antes de que se venzan</b>, en lugar de botarlos.
        </p>

        <div className="b-pasos">
          {PASOS.map((p, i) => (
            <div className="b-paso" key={p.texto}>
              <div className="b-n"><Icono n={p.icono} s={18} /></div>
              <div>
                <span className="b-orden">Paso {i + 1}</span>
                <p>{p.texto}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="b-rol">
          <div className="rotulo">Qué se espera de usted, {nombre.split(" ")[0]}</div>
          <p>{ESPERADO[rol]}</p>
        </div>

        <button className="btn btn-pri" onClick={onCerrar}>
          Entendido, empezar <Icono n="flecha" s={16} />
        </button>

        <p className="b-pie">
          Puede volver a leer esto cuando quiera, con el botón
          {" "}<b>¿Qué es esto?</b> de la barra superior.
        </p>
      </div>
    </div>
  );
}
