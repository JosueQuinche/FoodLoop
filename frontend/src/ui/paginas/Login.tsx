/**
 * FoodLoop · Inicio de sesión
 *
 * El perfil se elige aquí, no dentro de la aplicación. Es lo que
 * determina qué pantallas y qué acciones se habilitan después.
 *
 * En el prototipo la contraseña no se comprueba contra nada: la
 * autenticación real quedaría en un adaptador de entrada propio y no
 * cambiaría ni el dominio ni esta pantalla más allá de la llamada.
 */

import { useState } from "react";
import type { Rol } from "@foodloop/dominio";
import { PERFILES, permisosDe } from "@foodloop/dominio";
import { Logo, Icono } from "../componentes/UI";

const CORREOS: Record<Rol, string> = {
  chef: "m.calderon@cateringandes.ec",
  produccion: "l.ordonez@cateringandes.ec",
  admin: "k.jimenez@cateringandes.ec",
  calidad: "a.vega@cateringandes.ec",
};

const ALCANCE: Record<Rol, string> = {
  chef: "Registra mermas, aprueba recomendaciones y edita el recetario. Sin acceso a costos.",
  produccion: "Programa la ejecución y consulta costos. No modifica el recetario.",
  admin: "Perfil de consulta: indicadores y costos. No registra ni aprueba.",
  calidad: "Emite el dictamen sanitario. Sin acceso a costos ni a la programación.",
};

export default function Login(
  { onEntrar, onVolver }: {
    onEntrar: (rol: Rol) => void;
    onVolver: () => void;
  },
) {
  const [rol, setRol] = useState<Rol>("chef");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const permisos = permisosDe(rol);

  function entrar() {
    if (!clave.trim()) {
      setError("Escribe tu contraseña para continuar.");
      return;
    }
    setError(null);
    onEntrar(rol);
  }

  return (
    <div className="auth">
      <section className="auth-lado">
        <div className="fila" style={{ gap: 12 }}>
          <Logo tam={38} mono />
          <div>
            <div style={{ fontFamily: "Archivo", fontWeight: 700, fontSize: 18 }}>
              Food<span style={{ color: "#FBC490" }}>Loop</span>
            </div>
            <div className="rotulo" style={{ color: "inherit", opacity: 0.75 }}>
              Lo que sobra, inspira algo nuevo
            </div>
          </div>
        </div>

        <div>
          <h2>De la merma a nuevas recetas</h2>
          <p style={{ marginTop: 16, opacity: 0.88, maxWidth: "46ch" }}>
            A partir de las mermas disponibles, el modelo predice y recomienda
            recetas de reaprovechamiento, y explica en qué se basa cada propuesta
            antes de que la apruebes.
          </p>
        </div>

        <div className="auth-cifras">
          <div>
            <div className="n">312 kg</div>
            <div className="l">Recuperados este mes</div>
          </div>
          <div>
            <div className="n">$ 1 840</div>
            <div className="l">Costo evitado</div>
          </div>
        </div>
      </section>

      <section className="auth-form">
        <div className="auth-caja">
          <button className="btn btn-sm btn-fantasma" onClick={onVolver}
            style={{ marginBottom: 24, marginLeft: -11 }}>
            <Icono n="flecha-izq" s={15} /> Volver
          </button>

          <h1>Inicia sesión</h1>
          <p className="apagado" style={{ marginTop: 6, marginBottom: 24 }}>
            Usa tu cuenta corporativa del centro de producción.
          </p>

          <div className="pila" style={{ gap: 16 }}>
            <div className="campo">
              <label htmlFor="au-perfil">Perfil de acceso <span className="req">*</span></label>
              <div className="select-envoltura">
                <select className="entrada" id="au-perfil" value={rol}
                  onChange={(e) => setRol(e.target.value as Rol)}>
                  {Object.entries(PERFILES).map(([k, v]) =>
                    <option key={k} value={k}>{v.titulo}</option>)}
                </select>
              </div>
              <span className="ayuda">{ALCANCE[rol]}</span>
            </div>

            <div className="campo">
              <label htmlFor="au-correo">Correo corporativo</label>
              <input className="entrada" id="au-correo" type="email"
                value={CORREOS[rol]} readOnly
                style={{ color: "var(--texto-2)" }} />
              <span className="ayuda">Se completa según el perfil seleccionado.</span>
            </div>

            <div className="campo">
              <label htmlFor="au-clave">Contraseña <span className="req">*</span></label>
              <input className="entrada" id="au-clave" type="password"
                value={clave} autoComplete="current-password"
                placeholder="prototipo2026"
                onChange={(e) => { setClave(e.target.value); setError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") entrar(); }} />
              {error && <span className="error-campo">{error}</span>}
            </div>

            <div className="auth-resumen">
              <span className="rotulo">Con este perfil podrás</span>
              <ul>
                <li className={permisos.aprueba ? "si" : "no"}>
                  <Icono n={permisos.aprueba ? "check" : "x"} s={14} />
                  Aprobar recomendaciones
                </li>
                <li className={permisos.veCostos ? "si" : "no"}>
                  <Icono n={permisos.veCostos ? "check" : "x"} s={14} />
                  Consultar costos y valor en riesgo
                </li>
                <li className={permisos.editaRecetario ? "si" : "no"}>
                  <Icono n={permisos.editaRecetario ? "check" : "x"} s={14} />
                  Editar el recetario estandarizado
                </li>
                <li className={permisos.dictaminaSanidad ? "si" : "no"}>
                  <Icono n={permisos.dictaminaSanidad ? "check" : "x"} s={14} />
                  Emitir dictamen sanitario
                </li>
              </ul>
            </div>

            <button className="btn btn-primario btn-grande"
              style={{ justifyContent: "center" }} onClick={entrar}>
              Entrar como {PERFILES[rol].titulo.toLowerCase()}
            </button>

            <p className="pequeno apagado" style={{ textAlign: "center" }}>
              Prototipo de validación académica. Los datos mostrados son simulados.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
