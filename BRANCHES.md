# Feature Branches: `feature/table`, `mpra`, and `data`

Three branches are ahead of `main` with real, unmerged work. All three diverged from `main` at the same commit (`7c382eb`, "allow spaces and linebreaks in seqs") and are each missing one later commit that's since landed on `main` (`4a5bc0d`, "internal_notes") — worth picking up when merging or rebasing any of them.

For the rest of the project (routes, data model, setup), see [README.md](README.md).

## Overview

- **`feature/table`** — a new `/table` page: a fast, sortable, filterable (IUPAC-pattern) table of a protein's raw per-k-mer scores, with CSV export.
- **`mpra`** — a new `/mpra` page and backend pipeline for comparing uploaded MPRA (Massively Parallel Reporter Assay) variant-effect data against BindLine's predicted binding effects, including a windowed-correlation scan across every protein in the library.
- **`data`** — an internal correctness/robustness pass: displayed scores are now read from the same in-memory matrix used for identification instead of a separately re-parsed copy of the raw score file, and matrix saves are made atomic and load-time row-alignment-checked. No user-facing or API change.

## `feature/table`

One commit adds a lightweight `/table` view: pick a protein and score type, get its raw per-k-mer scores in a sortable, IUPAC-pattern-filterable table, with a CSV download — a faster alternative to the full BindLine plot when what you want is just the k-mer/score list. Adds `app/templates/table.html` and `app/static/table.js`, plus two small routes in `app/app.py` (`/table` and an API endpoint that returns a protein's score table as JSON).

## `mpra`

Five commits add a full new `/mpra` page for comparing experimental MPRA (Massively Parallel Reporter Assay) variant-effect data against BindLine's own predicted binding effects. It covers three workflows:

- **Upload MPRA data** (`/mpra/parse`) — read a reference sequence plus a set of variants and their measured effect sizes into the shape the rest of the page works with.
- **Compare to one protein** (`/mpra/single`) — score the reference sequence (and its variants) against a chosen protein's PBM data and overlay the predicted effect against the measured MPRA effect along the sequence, with a sliding-window, magnitude-weighted correlation score shown alongside.
- **Scan the whole library** (`/mpra/scan`) — run that same windowed correlation against every available protein and surface the best-correlated hits, useful for suggesting which protein(s) might explain an MPRA signal when the responsible protein isn't known in advance.

Adds `app/templates/mpra.html`, `app/static/mpra.js`, the `/mpra` routes above in `app/app.py`, and the new correlation/scoring functions behind them in `app/bindline_utils.py`. Along the way it also pulls the shared plotting code out of `app/static/script.js` into a new `app/static/plot_utils.js`, used by both the main page and the new MPRA page — so this branch is really the MPRA feature plus a plotting refactor bundled together.

## `data`

Two commits, no user-facing change: scores shown in the UI are now read straight from the same in-memory matrix used for identification, instead of a second, separately re-parsed copy of the raw score file — so the two can no longer silently disagree. Matrix files are also now saved atomically and checked for row-alignment on load, so a crash mid-write can't leave a corrupted or mismatched matrix on disk. Touches `app/tfidentifier.py`, `app/bindline_utils.py` (new `MatrixScoreTable` adapter), and `app/app.py`.
