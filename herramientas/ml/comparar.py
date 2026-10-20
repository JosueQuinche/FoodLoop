"""
FoodLoop · Comparación con otros algoritmos de aprendizaje automático

    npm run ml:entrenar          # genera evidencias/ml/dataset.csv
    npm run ml:comparar          # este script

Responde a la pregunta que cualquier revisor hace al ver una regresión
logística: ¿por qué no un bosque aleatorio, un gradient boosting o una
red neuronal? Entrena los cuatro sobre EXACTAMENTE el mismo conjunto y la
misma partición temporal que `entrenar.ts`, con las mismas métricas, y
además comprueba que la regresión logística de scikit-learn reproduce los
coeficientes que el dominio estimó en TypeScript.

Es opcional: la aplicación no necesita Python. Requiere
    pip install scikit-learn pandas numpy matplotlib
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

try:
    from sklearn.linear_model import LogisticRegression
    from sklearn.ensemble import RandomForestClassifier, HistGradientBoostingClassifier
    from sklearn.neural_network import MLPClassifier
    from sklearn.preprocessing import StandardScaler
    from sklearn.pipeline import make_pipeline
    from sklearn.metrics import roc_auc_score, average_precision_score, brier_score_loss
    from sklearn.calibration import calibration_curve
except ModuleNotFoundError:
    sys.exit("\n  Falta scikit-learn:  pip install scikit-learn pandas numpy matplotlib\n")

ENTRADAS = ["cobertura", "aporteMerma", "urgencia", "absorcion", "jerarquia",
            "aceptacion", "cargaArea", "frecuenciaMenu", "recenciaMenu"]
CORTE = "2026-05-01"
CORTES_CV = ["2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01"]


def metricas_ranking(df, s):
    d = df.assign(s=s).sort_values(["lote", "s", "receta"], ascending=[True, False, True])
    h1, h3, nd, kg = [], [], [], 0.0
    for _, g in d.groupby("lote", sort=False):
        y = g.y.to_numpy()
        if y[0]:
            kg += g.kg.iloc[0]
        if y.sum() == 0:
            continue
        h1.append(y[0]); h3.append(y[:3].max())
        dcg = sum(y[i] / np.log2(i + 2) for i in range(min(3, len(y))))
        idcg = sum(1 / np.log2(i + 2) for i in range(min(3, int(y.sum()))))
        nd.append(dcg / idcg)
    return dict(hr1=np.mean(h1), hr3=np.mean(h3), ndcg3=np.mean(nd),
                auc=roc_auc_score(df.y, s), ap=average_precision_score(df.y, s), kg=kg)


def modelos():
    return {
        "Regresión logística (sklearn)": LogisticRegression(
            C=1.0, solver="newton-cg", tol=1e-10, max_iter=10000),
        "Bosque aleatorio": RandomForestClassifier(300, min_samples_leaf=20, random_state=0, n_jobs=-1),
        "Gradient boosting": HistGradientBoostingClassifier(random_state=0),
        "Red neuronal (MLP 32-16)": make_pipeline(
            StandardScaler(), MLPClassifier((32, 16), alpha=1e-3, max_iter=300,
                                            early_stopping=True, random_state=0)),
    }


def principal():
    carpeta = Path(sys.argv[1] if len(sys.argv) > 1 else "evidencias/ml")
    df = pd.read_csv(carpeta / "dataset.csv")
    tr, te = df[df.fecha < CORTE], df[df.fecha >= CORTE]
    resumen = json.loads((carpeta / "resumen.json").read_text(encoding="utf-8"))
    coef_ts = resumen["modelo"]["coeficientes"]
    # Las entradas sin variación en el entrenamiento se fijan en cero en el
    # dominio; aquí se excluyen para que el problema sea el mismo. Si se
    # dejaran, scikit-learn repartiría el intercepto con esa columna
    # constante y los coeficientes no serían comparables.
    global ENTRADAS
    ENTRADAS = [e for e in ENTRADAS if e not in resumen["modelo"]["sinVariacion"]]

    print("\n  COMPARACIÓN DE ALGORITMOS · mismo conjunto y misma partición")
    print("  " + "=" * 76)
    filas, probas = [], {}
    for nombre, m in modelos().items():
        m.fit(tr[ENTRADAS], tr.y)
        p = m.predict_proba(te[ENTRADAS])[:, 1]
        probas[nombre] = p
        r = metricas_ranking(te, p)
        r["brier"] = brier_score_loss(te.y, p)
        filas.append(dict(modelo=nombre, **r))
        if nombre.startswith("Regresión"):
            print("  Reproducción de los coeficientes de TypeScript con scikit-learn:")
            print(f"    {'intercepto':16} sklearn {m.intercept_[0]:8.3f}   dominio {resumen['modelo']['intercepto']:8.3f}")
            for k, c in zip(ENTRADAS, m.coef_[0]):
                print(f"    {k:16} sklearn {c:8.3f}   dominio {coef_ts[k]:8.3f}")
            print()
    # híbrido desplegado, para tenerlo en la misma tabla
    lr = probas["Regresión logística (sklearn)"]
    filas.append(dict(modelo="Híbrido P×valor (v3, desplegado)",
                      **metricas_ranking(te, lr * te.valor.to_numpy()), brier=np.nan))
    filas.append(dict(modelo="Experto (v2.1)", **metricas_ranking(te, te.valor.to_numpy()), brier=np.nan))
    tab = pd.DataFrame(filas)
    print(tab.round(3).to_string(index=False))
    tab.to_csv(carpeta / "comparacion-algoritmos.csv", index=False)

    print("\n  VALIDACIÓN TEMPORAL · origen móvil (media ± desviación, 4 cortes)")
    print("  " + "=" * 76)
    cv = []
    for a, b in zip(CORTES_CV, CORTES_CV[1:]):
        t1, t2 = df[df.fecha < a], df[(df.fecha >= a) & (df.fecha < b)]
        for nombre, m in modelos().items():
            m.fit(t1[ENTRADAS], t1.y)
            cv.append(dict(corte=a, modelo=nombre, **metricas_ranking(t2, m.predict_proba(t2[ENTRADAS])[:, 1])))
    cv = pd.DataFrame(cv)
    agg = cv.groupby("modelo")[["hr3", "ndcg3", "auc"]].agg(["mean", "std"]).round(3)
    print(agg.to_string())
    cv.to_csv(carpeta / "validacion-algoritmos.csv", index=False)

    # curva de calibración de la regresión logística
    fr, mp = calibration_curve(te.y, lr, n_bins=8, strategy="quantile")
    pd.DataFrame(dict(prob_media=mp, frecuencia_observada=fr)).to_csv(
        carpeta / "calibracion.csv", index=False)
    print("\n  Escrito: comparacion-algoritmos.csv, validacion-algoritmos.csv, calibracion.csv\n")


if __name__ == "__main__":
    principal()
