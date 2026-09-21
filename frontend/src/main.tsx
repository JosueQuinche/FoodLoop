/**
 * FoodLoop · Arranque
 *
 * Tres estados: portada informativa, inicio de sesión y aplicación. El
 * rol se fija al entrar y condiciona todo lo que viene después.
 */
import { StrictMode, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { Usuario } from "@foodloop/dominio";
import Portada from "./ui/paginas/Portada";
import Login from "./ui/paginas/Login";
import App from "./ui/paginas/App";
import { useTema, Aviso } from "./ui/componentes/UI";
import "./estilos.css";

type Vista = "portada" | "login" | "app";

function Raiz() {
  const [vista, setVista] = useState<Vista>("portada");
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const { tema, alternar } = useTema();
  const temp = useRef<number>();

  const notificar = useCallback((t: string) => {
    setAviso(t);
    window.clearTimeout(temp.current);
    temp.current = window.setTimeout(() => setAviso(null), 3600);
  }, []);

  return (
    <>
      {vista === "portada" && <Portada onEntrar={() => setVista("login")} />}

      {vista === "login" && (
        <Login
          onVolver={() => setVista("portada")}
          onEntrar={(u) => { setUsuario(u); setVista("app"); }}
        />
      )}

      {vista === "app" && usuario && (
        <App
          usuario={usuario}
          onSalir={() => setVista("login")}
          tema={tema}
          alternarTema={alternar}
          notificar={notificar}
        />
      )}

      <Aviso texto={aviso} />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><Raiz /></StrictMode>
);
