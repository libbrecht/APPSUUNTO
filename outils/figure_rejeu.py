#!/usr/bin/env python3
"""Figure de validation d'un rejeu (CSV écrit par outils/rejouer.js --csv).

Trois bandeaux alignés sur la distance :
  1. profil d'altitude, avec une zone à mettre en évidence (le mur) ;
  2. terrain détecté par l'app et terrain réel calculé après coup sur
     l'altitude (vitesse verticale centrée sur ±30 s) ;
  3. FC, cible active et secondes au rouge.

Usage : python3 outils/figure_rejeu.py rejeu.csv figure.png
            [--titre "..."] [--zone 18.2-19.6:le mur]
Nécessite matplotlib.
"""
import argparse
import csv

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Patch  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402

# Palette de référence (validée : 3 teintes, toutes paires, mode clair)
SURFACE = "#fcfcfb"
ENCRE = "#0b0b0b"
ENCRE_2 = "#52514e"
MUET = "#898781"
GRILLE = "#e1e0d9"
AXE = "#c3c2b7"
TERRAINS = {0: ("Plat", "#2a78d6"), 1: ("Montée", "#eb6834"), 2: ("Descente", "#1baf7a")}
ARRET = "#898781"
AMBIGU = "#e1e0d9"
CRITIQUE = "#d03b3b"


def lire(fichier):
    lignes = []
    with open(fichier, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f, delimiter=";"):
            if not r["distance"] or not r["altitude"]:
                continue
            lignes.append({
                "km": float(r["distance"]) / 1000,
                "alt": float(r["altitude"]),
                "etat": int(r["etat"]),
                "couleur": int(r["couleur"]),
                "cible": float(r["cible"]),
                "fc": float(r["fc"]),
            })
    return lignes


def terrain_reel(lignes, fenetre=30):
    n = len(lignes)
    res = []
    for i in range(n):
        a, b = max(0, i - fenetre), min(n - 1, i + fenetre)
        v = (lignes[b]["alt"] - lignes[a]["alt"]) / max(1, b - a) * 3600
        res.append(1 if v >= 300 else 2 if v <= -300 else 0 if abs(v) <= 150 else -1)
    return res


def segments(kms, valeurs):
    """Plages contiguës (début, fin, valeur) le long de la distance."""
    res = []
    debut = 0
    for i in range(1, len(valeurs) + 1):
        if i == len(valeurs) or valeurs[i] != valeurs[debut]:
            res.append((kms[debut], kms[i - 1], valeurs[debut]))
            debut = i
    return res


def couleur_terrain(v):
    if v in TERRAINS:
        return TERRAINS[v][1]
    return ARRET if v == 3 else AMBIGU


def main():
    p = argparse.ArgumentParser()
    p.add_argument("csv")
    p.add_argument("png")
    p.add_argument("--titre", default="Rejeu de la sortie à travers Trois Chiffres")
    p.add_argument("--sous-titre", default="")
    p.add_argument("--zone", default="", help="début-fin:libellé, en km")
    a = p.parse_args()

    lignes = lire(a.csv)
    kms = [l["km"] for l in lignes]
    reel = terrain_reel(lignes)

    plt.rcParams.update({
        "font.family": "DejaVu Sans",
        "font.size": 9,
        "axes.edgecolor": AXE,
        "axes.labelcolor": ENCRE_2,
        "xtick.color": MUET,
        "ytick.color": MUET,
        "axes.facecolor": SURFACE,
        "figure.facecolor": SURFACE,
    })
    fig, (ax1, ax2, ax3) = plt.subplots(
        3, 1, figsize=(10, 6.2), sharex=True,
        gridspec_kw={"height_ratios": [3, 1.1, 3], "hspace": 0.12})

    zone = None
    if a.zone:
        bornes, _, libelle = a.zone.partition(":")
        z0, z1 = (float(x) for x in bornes.split("-"))
        zone = (z0, z1, libelle)

    # 1. Profil
    ax1.plot(kms, [l["alt"] for l in lignes], color=ENCRE_2, lw=1.4)
    ax1.set_ylabel("altitude (m)")
    if zone:
        for ax in (ax1, ax2, ax3):
            ax.axvspan(zone[0], zone[1], color=GRILLE, alpha=0.55, lw=0, zorder=0)
        ax1.annotate(zone[2], xy=((zone[0] + zone[1]) / 2, ax1.get_ylim()[1]),
                     xytext=(0, -12), textcoords="offset points", ha="center",
                     color=ENCRE_2, fontsize=9)

    # 2. Rubans : app et réel
    for y, valeurs in ((1, [l["etat"] for l in lignes]), (0, reel)):
        for d, f, v in segments(kms, valeurs):
            ax2.broken_barh([(d, max(f - d, 0.004))], (y + 0.12, 0.76),
                            facecolors=couleur_terrain(v), lw=0)
    ax2.set_yticks([0.5, 1.5], ["réel", "app"])
    ax2.set_ylim(0, 2)
    ax2.tick_params(axis="y", length=0, colors=ENCRE_2)
    for s in ("top", "right", "left"):
        ax2.spines[s].set_visible(False)

    # 3. FC, cible et rouge
    ax3.plot(kms, [l["fc"] if l["fc"] > 0 else float("nan") for l in lignes],
             color=ENCRE_2, lw=0.9, label="FC")
    ax3.step(kms, [l["cible"] for l in lignes], where="post", color=ENCRE, lw=1.3,
             ls=(0, (4, 2)), label="cible active")
    for d, f, v in segments(kms, [l["couleur"] == 3 for l in lignes]):
        if v:
            ax3.axvspan(d, f, color=CRITIQUE, alpha=0.16, lw=0)
    ax3.set_ylabel("FC (bpm)")
    ax3.set_xlabel("distance (km)")
    ax3.set_ylim(100, 190)

    for ax in (ax1, ax3):
        ax.grid(axis="y", color=GRILLE, lw=0.6)
        ax.set_axisbelow(True)
        for s in ("top", "right"):
            ax.spines[s].set_visible(False)

    # Légendes (identité jamais portée par la seule couleur)
    terrains = [Patch(color=c, label=n) for n, c in TERRAINS.values()]
    terrains += [Patch(color=AMBIGU, label="ambigu (150 à 300 m/h)"), Patch(color=ARRET, label="arrêt")]
    fig.legend(handles=terrains, ncol=5, loc="upper left", bbox_to_anchor=(0.075, 0.915),
               frameon=False, fontsize=8, handlelength=1.2)
    ax3.legend(handles=[Line2D([], [], color=ENCRE_2, lw=1, label="FC"),
                        Line2D([], [], color=ENCRE, lw=1.3, ls=(0, (4, 2)), label="cible active"),
                        Patch(color=CRITIQUE, alpha=0.3, label="au-dessus de la cible (rouge)")],
               ncol=3, loc="upper left", frameon=False, fontsize=8)

    fig.suptitle(a.titre, x=0.085, ha="left", fontsize=12, color=ENCRE, y=0.985)
    if a.sous_titre:
        fig.text(0.085, 0.94, a.sous_titre, ha="left", fontsize=9, color=ENCRE_2)
    ax3.set_xlim(0, kms[-1])
    fig.subplots_adjust(left=0.085, right=0.985, top=0.86, bottom=0.08)
    fig.savefig(a.png, dpi=170)


if __name__ == "__main__":
    main()
