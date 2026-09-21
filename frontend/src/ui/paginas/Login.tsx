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
import type { Rol, Usuario } from "@foodloop/dominio";
import { ErrorDominio, PERFILES, permisosDe } from "@foodloop/dominio";
import { api } from "../../infraestructura/adaptadores/salida/http/repositorios";
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
    onEntrar: (u: Usuario) => void;
    onVolver: () => void;
  },
) {
  const [modo, setModo] = useState<"entrar" | "registro">("entrar");
  const [rol, setRol] = useState<Rol>("chef");
  const [correo, setCorreo] = useState(CORREOS.chef);
  const [nombre, setNombre] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const permisos = permisosDe(rol);

  function cambiarRol(r: Rol) {
    setRol(r);
    // En alta de cuenta el correo lo escribe la persona; al entrar se
    // propone el de la cuenta de ejemplo de ese perfil.
    if (modo === "entrar") setCorreo(CORREOS[r]);
    setError(null);
  }

  async function enviar() {
    setError(null);
    setCargando(true);
    try {
      const usuario = modo === "entrar"
        ? await api.iniciarSesion(correo, clave)
        : await (async () => {
            await api.registrar({ correo, nombre, rol, clave });
            return api.iniciarSesion(correo, clave);
          })();
      onEntrar(usuario);
    } catch (e) {
      setError(e instanceof ErrorDominio
        ? e.message
        : "No hay conexión con el servidor. Comprueba que esté corriendo.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="auth">
      <section className="auth-lado">
        <div>
          {/* El logotipo ya contiene el nombre, de modo que repetirlo en
              texto al lado sería redundante. */}
          <div className="logo-caja">
            <Logo tam={190} completo />
          </div>
          <div className="rotulo" style={{ color: "inherit", opacity: 0.8, marginTop: 14 }}>
            Lo que sobra, inspira algo nuevo
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
            style={{ marginBottom: 20, marginLeft: -11 }}>
            <Icono n="flecha-izq" s={15} /> Volver
          </button>

          <div className="pestanas">
            <button className={modo === "entrar" ? "activa" : ""}
              onClick={() => { setModo("entrar"); setCorreo(CORREOS[rol]); setError(null); }}>
              Iniciar sesión
            </button>
            <button className={modo === "registro" ? "activa" : ""}
              onClick={() => { setModo("registro"); setCorreo(""); setError(null); }}>
              Crear cuenta
            </button>
          </div>

          <h1 style={{ marginTop: 20 }}>
            {modo === "entrar" ? "Inicia sesión" : "Crea tu cuenta"}
          </h1>
          <p className="apagado" style={{ marginTop: 6, marginBottom: 22 }}>
            {modo === "entrar"
              ? "Usa tu cuenta corporativa del centro de producción."
              : "El perfil que elijas define qué podrás hacer en el sistema."}
          </p>

          <div className="pila" style={{ gap: 15 }}>
            <div className="campo">
              <label htmlFor="au-perfil">Perfil <span className="req">*</span></label>
              <div className="select-envoltura">
                <select className="entrada" id="au-perfil" value={rol}
                  onChange={(e) => cambiarRol(e.target.value as Rol)}>
                  {Object.entries(PERFILES).map(([k, v]) =>
                    <option key={k} value={k}>{v.titulo}</option>)}
                </select>
              </div>
              <span className="ayuda">{ALCANCE[rol]}</span>
            </div>

            {modo === "registro" && (
              <div className="campo">
                <label htmlFor="au-nombre">Nombre completo <span className="req">*</span></label>
                <input className="entrada" id="au-nombre" value={nombre}
                  autoComplete="name" placeholder="Nombre y apellido"
                  onChange={(e) => { setNombre(e.target.value); setError(null); }} />
              </div>
            )}

            <div className="campo">
              <label htmlFor="au-correo">Correo corporativo <span className="req">*</span></label>
              <input className="entrada" id="au-correo" type="email" value={correo}
                autoComplete="username" placeholder="nombre@empresa.ec"
                onChange={(e) => { setCorreo(e.target.value); setError(null); }} />
            </div>

            <div className="campo">
              <label htmlFor="au-clave">Contraseña <span className="req">*</span></label>
              <input className="entrada" id="au-clave" type="password" value={clave}
                autoComplete={modo === "entrar" ? "current-password" : "new-password"}
                placeholder={modo === "entrar" ? "" : "Mínimo 8 caracteres"}
                onChange={(e) => { setClave(e.target.value); setError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") void enviar(); }} />
              {modo === "entrar" && (
                <span className="ayuda">
                  Cuentas de ejemplo: la contraseña es <b>foodloop2026</b>.
                </span>
              )}
            </div>

            {error && (
              <div className="aviso" style={{ borderColor: "var(--critico-linea)" }}>
                <Icono n="alerta" s={16} />
                <span className="pequeno">{error}</span>
              </div>
            )}

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
              style={{ justifyContent: "center" }}
              aria-disabled={cargando}
              onClick={() => void enviar()}>
              {cargando ? "Conectando…"
                : modo === "entrar"
                  ? `Entrar como ${PERFILES[rol].titulo.toLowerCase()}`
                  : "Crear cuenta y entrar"}
            </button>

            <p className="pequeno apagado" style={{ textAlign: "center" }}>
              Prototipo de validación académica. Los datos son simulados.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
