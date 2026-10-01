"""
Öngörücü bakım modeli eğitimi.

  npm run ml:dataset   # önce eğitim verisini üret (data/ml/dataset.csv)
  npm run ml:train     # bu betik → src/ml/modelData.ts

Soru: "Bu makinede önümüzdeki 24 saatte arıza olacak mı?"
Model: sığ ağaçlı Gradient Boosting (scikit-learn). Ağaçlar TypeScript'e aktarılır; model
hem collector'da hem tarayıcıda (web demo) Python'suz çalışır. Python sadece eğitim içindir.

Değerlendirme olay bazındadır (fabrikanın sorduğu soru budur):
  - yakalanan arıza: arızadan 1–24 saat önce en az bir alarm verildiyse
  - uyarı süresi: arızadan kaç saat önce ilk alarm verildi
  - boş alarm: ardından 24 saat içinde arıza gelmeyen alarm dönemi (makine-hafta başına)
"""
from __future__ import annotations

import json
import math
import warnings
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "ml" / "dataset.csv"
INFO = ROOT / "data" / "ml" / "dataset-info.json"
OUT = ROOT / "src" / "ml" / "modelData.ts"

FEATURES = [
    "cur_ratio_1h", "cur_slope_24h", "vib_1h", "vib_slope_24h", "temp_dev_1h",
    "micro_6h", "micro_24h", "speed_cv_1h", "run_h_since_maint", "line_L1", "line_L2", "line_L3",
]
HOUR = 3600 * 1000
DAY = 24 * HOUR
TEST_DAYS = 30
VAL_DAYS = 30
ALARM_FA_BUDGET = 0.5   # makine-hafta başına en fazla boş alarm ("Riskli")
WATCH_FA_BUDGET = 2.0   # "Dikkat" seviyesi daha hassas


# macOS'un Accelerate matris kütüphanesi numpy 2 ile zararsız "matmul" uyarıları üretir
warnings.filterwarnings("ignore", message=".*encountered in matmul", category=RuntimeWarning)


def make_model(seed: int = 42) -> GradientBoostingClassifier:
    return GradientBoostingClassifier(n_estimators=150, max_depth=3, learning_rate=0.08, subsample=0.8, random_state=seed)


def failures_of(df: pd.DataFrame) -> pd.DataFrame:
    """Örneklerdeki 'bir sonraki arıza' bilgisinden arıza olaylarını çıkarır."""
    f = df[df.hours_to_failure >= 0].copy()
    f["ft"] = (f.t + (f.hours_to_failure * HOUR).round()).astype("int64")
    f = f.groupby(["machine_id", "ft"], as_index=False).agg(predictable=("next_failure_predictable", "max"))
    return f


def evaluate(df: pd.DataFrame, prob: np.ndarray, thr: float, t_from: int, t_to: int) -> dict:
    d = df.assign(p=prob, alarm=prob >= thr)
    all_fails = failures_of(d)
    fails = all_fails[(all_fails.ft >= t_from + DAY) & (all_fails.ft < t_to)]
    caught, leads, caught_pred, n_pred, caught_sud, n_sud = 0, [], 0, 0, 0, 0
    false_eps, eps = 0, 0
    for mid, g in d.groupby("machine_id"):
        g = g.sort_values("t")
        at = g.t[g.alarm].to_numpy()
        mf = fails[fails.machine_id == mid]
        for ft, pred in zip(mf.ft, mf.predictable):
            w = at[(at >= ft - 24 * HOUR) & (at <= ft - HOUR)]
            hit = len(w) > 0
            caught += hit
            if hit:
                leads.append((ft - w.min()) / HOUR)
            if pred == 1:
                n_pred += 1
                caught_pred += hit
            else:
                n_sud += 1
                caught_sud += hit
        # alarm dönemleri (aralarında 1 saatten fazla boşluk yoksa tek dönem)
        all_ft = all_fails.ft[all_fails.machine_id == mid].to_numpy()
        if len(at):
            starts = [at[0]]
            ends = []
            for a, b in zip(at[:-1], at[1:]):
                if b - a > HOUR:
                    ends.append(a)
                    starts.append(b)
            ends.append(at[-1])
            for s, e in zip(starts, ends):
                eps += 1
                if not np.any((all_ft > s) & (all_ft <= e + 24 * HOUR)):
                    false_eps += 1
    machine_weeks = d.machine_id.nunique() * (t_to - t_from) / (7 * DAY)
    n = len(fails)
    return {
        "failures": int(n),
        "caught": int(caught),
        "caughtPct": caught / n if n else 0.0,
        "predictableFailures": int(n_pred),
        "caughtPredictablePct": caught_pred / n_pred if n_pred else 0.0,
        "suddenFailures": int(n_sud),
        "caughtSuddenPct": caught_sud / n_sud if n_sud else 0.0,
        "leadHoursMedian": float(np.median(leads)) if leads else 0.0,
        "leadHoursMean": float(np.mean(leads)) if leads else 0.0,
        "alarmEpisodes": int(eps),
        "falseAlarms": int(false_eps),
        "falseAlarmsPerMachineWeek": false_eps / machine_weeks if machine_weeks else 0.0,
        "precision": (eps - false_eps) / eps if eps else 0.0,
    }


def pick_threshold(df: pd.DataFrame, prob: np.ndarray, budget: float, t_from: int, t_to: int) -> float:
    """Boş alarm bütçesini aşmadan en çok arıza yakalayan eşik."""
    best_thr, best = 0.99, -1.0
    for thr in np.arange(0.95, 0.04, -0.01):
        m = evaluate(df, prob, float(thr), t_from, t_to)
        if m["falseAlarmsPerMachineWeek"] <= budget and m["caughtPct"] > best:
            best, best_thr = m["caughtPct"], float(thr)
    return round(best_thr, 2)


def export_trees(model: GradientBoostingClassifier) -> list[dict]:
    out = []
    for est in model.estimators_[:, 0]:
        t = est.tree_
        out.append({
            "f": t.feature.tolist(),
            "t": [float(x) for x in t.threshold],
            "l": t.children_left.tolist(),
            "r": t.children_right.tolist(),
            "v": [float(x) for x in t.value[:, 0, 0]],
        })
    return out


def manual_proba(model_json: dict, x: np.ndarray) -> float:
    """TypeScript değerlendiricisinin aynısı (float32 karşılaştırma dahil) — kendini doğrulama."""
    raw = model_json["init"]
    for tr in model_json["trees"]:
        n = 0
        while tr["l"][n] != -1:
            n = tr["l"][n] if float(np.float32(x[tr["f"][n]])) <= tr["t"][n] else tr["r"][n]
        raw += model_json["learningRate"] * tr["v"][n]
    return 1.0 / (1.0 + math.exp(-raw))


def main() -> None:
    df = pd.read_csv(DATA).sort_values(["t", "machine_id"]).reset_index(drop=True)
    info = json.loads(INFO.read_text())
    t_end = int(df.t.max()) + HOUR
    test_from = t_end - TEST_DAYS * DAY
    # 24 saatlik etiket penceresi sızmasın diye eğitim test başlangıcından 1 gün önce biter
    train = df[df.t < test_from - DAY]
    test = df[df.t >= test_from]
    val_from = int(train.t.max()) + HOUR - VAL_DAYS * DAY
    fit = train[train.t < val_from - DAY]
    val = train[train.t >= val_from]
    print(f"eğitim {len(train)} · doğrulama {len(val)} · test {len(test)} satır")

    # 1) Eşikleri doğrulama döneminde seç (test verisine bakmadan)
    m_fit = make_model().fit(fit[FEATURES], fit.label)
    p_val = m_fit.predict_proba(val[FEATURES])[:, 1]
    vt_to = int(val.t.max()) + HOUR
    thr_alarm = pick_threshold(val, p_val, ALARM_FA_BUDGET, val_from, vt_to)
    thr_watch = min(thr_alarm, pick_threshold(val, p_val, WATCH_FA_BUDGET, val_from, vt_to))
    print(f"eşikler: Dikkat ≥ {thr_watch} · Riskli ≥ {thr_alarm}")

    # 2) Son model: tüm eğitim dönemiyle
    model = make_model().fit(train[FEATURES], train.label)
    p_test = model.predict_proba(test[FEATURES])[:, 1]
    metrics = evaluate(test, p_test, thr_alarm, test_from, t_end)
    metrics_watch = evaluate(test, p_test, thr_watch, test_from, t_end)

    # Karşılaştırma: lojistik regresyon, aynı boş alarm bütçesinde
    lr = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000)).fit(train[FEATURES], train.label)
    p_lr = lr.predict_proba(test[FEATURES])[:, 1]
    lr_thr = pick_threshold(test, p_lr, ALARM_FA_BUDGET, test_from, t_end)
    gb_best = pick_threshold(test, p_test, ALARM_FA_BUDGET, test_from, t_end)
    baseline = {
        "logisticCaughtPct": evaluate(test, p_lr, lr_thr, test_from, t_end)["caughtPct"],
        "boostingCaughtPct": evaluate(test, p_test, gb_best, test_from, t_end)["caughtPct"],
    }
    print("test:", json.dumps(metrics, ensure_ascii=False))

    # 3) Öğrenme eğrisi: veri arttıkça başarı (aynı boş alarm bütçesinde).
    #    Tek eğitim gürültülüdür (test döneminde ~80 arıza); her nokta 3 farklı tohumun ortalaması.
    curve = []
    train_end = int(train.t.max()) + HOUR
    for months in [0.25, 0.5, 1, 2, 3, 5]:
        sub = train[train.t >= train_end - months * 30 * DAY]
        n_fail = len(failures_of(sub))
        if sub.label.nunique() < 2:
            continue
        runs = []
        for seed in (1, 2, 3):
            mm = make_model(seed).fit(sub[FEATURES], sub.label)
            pp = mm.predict_proba(test[FEATURES])[:, 1]
            thr = pick_threshold(test, pp, ALARM_FA_BUDGET, test_from, t_end)
            ev = evaluate(test, pp, thr, test_from, t_end)
            runs.append((ev["caughtPct"], ev["caughtPredictablePct"], ev["leadHoursMedian"], average_precision_score(test.label, pp)))
        r = np.mean(np.array(runs), axis=0)
        curve.append({"months": months, "trainFailures": int(n_fail), "caughtPct": float(r[0]), "caughtPredictablePct": float(r[1]), "leadHoursMedian": float(r[2]), "averagePrecision": float(r[3])})
        print(f"  {months} ay · {n_fail} arıza örneği → yakalanan %{r[0] * 100:.0f} (öngörülebilir %{r[1] * 100:.0f}) · AP {r[3]:.2f}")

    # 4) Açıklamalar için "sağlıklı" referans: yıpranması düşük, arıza yaklaşmayan örneklerin medyanı
    healthy = train[(train.label == 0) & (train.degradation < 0.3)]
    reference = [float(healthy[f].median()) for f in FEATURES]

    raw_init = float(np.log(model.init_.class_prior_[1] / model.init_.class_prior_[0]))
    model_json = {
        "init": raw_init,
        "learningRate": model.learning_rate,
        "trees": export_trees(model),
    }
    # Kendini doğrulama: elle hesap = scikit-learn
    picked = test[FEATURES].iloc[:: max(1, len(test) // 50)].iloc[:50]
    xs = picked.to_numpy()
    ps = model.predict_proba(picked)[:, 1]
    for x, p in zip(xs, ps):
        assert abs(manual_proba(model_json, x) - p) < 1e-9, "ağaç aktarımı hatalı"

    importances = sorted(zip(FEATURES, model.feature_importances_), key=lambda z: -z[1])
    data = {
        "version": 1,
        "trainedAt": date.today().isoformat(),
        "algorithm": "Gradient Boosting (150 ağaç, derinlik 3)",
        "horizonHours": 24,
        "features": FEATURES,
        "thresholds": {"watch": thr_watch, "alarm": thr_alarm},
        **model_json,
        "reference": reference,
        "importances": [{"feature": f, "value": float(v)} for f, v in importances],
        "dataset": {**info, "trainRows": int(len(train)), "testRows": int(len(test)), "testDays": TEST_DAYS, "trainFailures": int(len(failures_of(train)))},
        "metrics": metrics,
        "metricsWatch": metrics_watch,
        "baseline": baseline,
        "learningCurve": curve,
        "samples": [{"x": [float(v) for v in x], "p": float(p)} for x, p in zip(xs, ps)],
    }
    OUT.write_text(
        "// OTOMATİK ÜRETİLDİ — elle düzenlemeyin. Kaynak: ml/train.py (npm run ml:train)\n"
        "import type { ModelData } from './model'\n\n"
        f"export const MODEL_DATA: ModelData = {json.dumps(data, ensure_ascii=False)}\n"
    )
    print(f"→ {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
