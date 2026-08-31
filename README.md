# BindLine

BindLine is a Flask web application for exploring protein–DNA binding using Protein Binding Microarray (PBM) data. It lets a user pick a protein's PBM results, load one or more (aligned) DNA sequences, and visualize the protein's predicted binding strength continuously along those sequences — rather than reducing binding preference to a single consensus motif.

## Overview

PBM experiments score every possible DNA k-mer for how strongly a protein binds it. BindLine takes those per-k-mer scores and a DNA sequence and plots the score of the k-mer starting at every position, so binding can be inspected directly on the sequence, including binding that is weak, degenerate, or spread across several sub-optimal sites.

Typical workflow:

1. Pick a protein's PBM data — a public dataset or a file you upload — and a score type (E-score, Z-score, or I-score).
2. Load one or more DNA sequences (FASTA upload or manual entry). When comparing multiple sequences, they must be aligned, with the first sequence treated as the reference and the others as substitutions/insertions/deletions relative to it. Alternatively, users can choose the reference sequence by hand on the website.
3. Inspect the resulting plot; optionally set score/rank thresholds to highlight discrete "binding sites" and enable the binding-sites plot.
4. Optionally: scan across all available proteins for hits above a threshold, or enumerate every single-nucleotide substitution/insertion/deletion of the reference and see which ones create or destroy a binding site ("All Mutants").

Logged-in users can upload and manage their own PBM score files and FASTA files from a personal dashboard; a public data page exposes the built-in PBM datasets and sample sequences for anonymous use.

## Key Features

- **Continuous binding visualization** ("BindLine" plot) of PBM scores along one or more aligned DNA sequences, with per-sequence/per-protein legend toggling and grouping.
- **Three PBM score types** — E-score (rank-normalized enrichment, −0.5 to 0.5), Z-score (deviation from the median k-mer), and I-score (raw median fluorescence intensity) — parsed from UniProbe-format and CIS-BP-format result files.
- **Threshold-based binding-site detection**, with independent absolute-score and rank-percentile thresholds, and automatic grouping of overlapping sites by protein family (Pfam).
- **Cross-protein scanning**: search every available PBM dataset for k-mers in the input sequence that clear a threshold, useful when the binding protein is unknown.
- **All-mutants analysis**: enumerate every point substitution, insertion, and deletion of a reference sequence and show which ones gain or lose a binding site, with a plot of the effect (Δscore) of each mutation.
- **"Diff-only" mode** that restricts a multi-sequence comparison to sites that appeared or disappeared relative to the reference sequence.
- **User accounts and a personal dashboard** for uploading, tagging (dataset/publication/species/Pfam), downloading, and deleting private FASTA and score files, backed by a small SQLite database.
- **Public data page** for downloading the bundled PBM score files and FASTA sequences without logging in.

## Tech Stack

- **Backend**: Python, [Flask](https://flask.palletsprojects.com/) (+ `flask-cors`, `flask-login`, `flask-sqlalchemy`), served over HTTPS via a provided TLS cert.
- **Data/science**: `pandas`, `numpy`, `biopython` (sequence alignment), `seqlogo` + `matplotlib` (motif logos), `tqdm`.
- **Database**: SQLite via SQLAlchemy (`app/instance/database.db`, created at runtime).
- **Frontend**: server-rendered Jinja2 templates, vanilla JavaScript ES modules, Bootstrap, and [jQuery](https://jquery.com/)/[Select2](https://select2.org/) for searchable dropdowns.

## Project Structure

This reflects the files tracked in git on `main`:

```
bindline_server/
├── requirements.txt          # Python dependencies
├── .gitignore                 # excludes __pycache__, .idea, data/, past/, work/, config.json, ...
└── app/                        # the Flask application package
    ├── __init__.py             # (empty) marks `app` as a package
    ├── app.py                  # Flask app setup, routes, and request handlers
    ├── auth.py                 # `auth` blueprint: register/login/logout, username lookup by uuid
    ├── bindline.py              # PBM file/table parsing (UniProbe, CIS-BP) and scoring classes
    ├── bindline_utils.py        # sequence alignment, mutation enumeration, binding-site/threshold logic
    ├── consts.py                 # paths and constants, some are loaded from config.json
    ├── database_setup.py         # SQLAlchemy models: User, File, Pfam (+ file<->pfam association)
    ├── export.py                 # CSV/JSON export of plotted results
    ├── files.py                   # `files` blueprint + file metadata/listing/deletion helpers
    ├── tfidentifier.py            # TFIdentifier: fast per-k-mer lookup/threshold index across proteins
    ├── static/
    │   ├── auth.js                 # login/signup modal wiring
    │   ├── dashboard.js             # "select all" checkbox wiring for bulk file actions
    │   ├── help.js                  # click-to-zoom modal for the help page's screenshots
    │   ├── samples.js               # "load sample data" buttons
    │   ├── script.js                 # main index-page logic: plotting, thresholds, mutants, scan-all
    │   ├── sequences_table.js         # sequence input/editor table
    │   ├── toast.js                   # toast notifications
    │   ├── utils.js                    # small DOM helpers
    │   ├── styles.css                  # site-wide styles
    │   ├── icons/
    │   │   └── favicon.ico
    │   ├── img/                            # help-page screenshots + logo
    │   │   ├── help_intro.png
    │   │   ├── help_seq_table.png
    │   │   ├── help_scoring.png
    │   │   ├── help_thresholds.png
    │   │   ├── help_across_proteins.png
    │   │   ├── help_mutations.png
    │   │   ├── help_diff.png
    │   │   ├── help_data.png
    │   │   └── logo.png
    │   └── samples/                         # bundled "Load Sample" data
    │       ├── score.tsv
    │       └── sequences.fasta
    └── templates/
        ├── header.html / footer.html      # shared nav/footer, included by every page
        ├── index.html                       # main BindLine analysis page
        ├── dashboard.html                    # logged-in user's file dashboard
        ├── data.html                          # public data download page
        └── help.html                           # in-app documentation
```

`config.json`, `app/instance/database.db`, and the `data/` directories are used at runtime but are intentionally **not** tracked in git (see `.gitignore`); see [Configuration](#configuration) below.

## Getting Started

### Prerequisites

- Python 3.11+
- A TLS certificate + key (BindLine only serves over HTTPS)

### Installation

```bash
git clone <this-repository>
cd bindline_server
python -m venv venv
source venv/bin/activate   # venv\Scripts\activate on Windows
pip install -r requirements.txt
```

### Configuration

`app/consts.py` and `app/app.py` read a `config.json` file in the repository root at import time. It is not committed to git (it typically holds local filesystem paths and, in production, secrets), so create it yourself:

```json
{
  "data_dir": "data",
  "ssl_cert": "/path/to/cert.pem",
  "ssl_key": "/path/to/key.pem"
}
```

- `data_dir` — root directory for uploads and results (defaults to `data` if omitted); BindLine creates `data/uploads/{fasta,score}` under it automatically on startup.
- `ssl_cert` / `ssl_key` — required: paths to a TLS certificate and private key, since `app/app.py` builds an `ssl.SSLContext` from them unconditionally.

### Running

The app is a package (`app/`) that uses relative imports, so run it as a module from the repository root:

```bash
python -m app.app
```

This starts Flask on `0.0.0.0:443` over HTTPS (see the bottom of `app/app.py`). The SQLite database and `instance/` folder are created automatically on first run via `database_setup.init_db`/`db.init_app`.

## Data Model

Three SQLAlchemy models back the app (`app/database_setup.py`):

- **`User`** — `username`, hashed `password`, and a `uuid` used to namespace a user's uploaded score matrices on disk.
- **`File`** — an uploaded FASTA or score file's metadata (`file_type`, `dataset`, `publication`, `species`, curator-facing `notes`, an admin-only `internal_notes` field never exposed to templates/JS, and `is_public`), linked to its owning `User` and to zero or more `Pfam`s.
- **`Pfam`** — a protein family name, many-to-many with `File` via the `file2pfam` association table, used to group binding sites by family in the UI.

## Scoring Data: Result Tables and Match Matrices

Every PBM score file is parsed once into an in-memory `ResultTable` (`app/bindline.py`) and, for k-mer-based score types, also folded into a persisted matrix that `TFIdentifier` (`app/tfidentifier.py`) uses to scan across every protein at once.

**Result tables.** `ResultFile` subclasses (`PWMFile`, `EScoreFile`, `ZScoreFile`, `IScoreFile`, each with a UniProbe- and a CIS-BP-format variant) parse a raw score file into one or more `ResultTable`s:

- **`PWMTable`** — a position-weight matrix, used to render a motif logo (`.to_logo()`) and to score a sequence by summing per-position log-odds.
- **`EScoreTable`** (and its subclasses **`ZScoreTable`**, **`IScoreTable`**) — a flat dict mapping every k-mer to its score, used for E-score, Z-score, and I-score data. Scoring a sequence just looks up each of its k-mers; `rank_threshold()` turns a percentile (e.g. "top 5%") into an absolute score cutoff for binding-site detection.

**Match matrices.** Cross-protein scanning ("search every available PBM dataset for k-mers that clear a threshold") would be far too slow if it had to re-parse every protein's score file on every request. Instead, `EScoreTable.vectorize()` turns a protein's score dict into a dense vector of length 4^k (one entry per k-mer, in a fixed A/C/G/T order), and `TFIdentifier` stacks every protein's vector into one `(num_proteins × 4^k)` NumPy matrix per k-mer length — so a scan across the whole library becomes a single vectorized matrix operation instead of a loop over files.

These matrices are persisted as `.npy` files (one pair per k-mer length `k` per score type) under `data/uploads/score/public/identifiers/<score_type>/` for the bundled public datasets, or `data/uploads/score/<user_uuid>/identifiers/<score_type>/` for a user's own uploads:

- `{k}_abs.npy` / `{k}_abs_ids.npy` — the absolute-score matrix and a row-aligned array of which protein/file each row belongs to.
- `{k}_rank.npy` / `{k}_rank_ids.npy` — the same, for rank/percentile-based scoring.

They're rebuilt incrementally as files are uploaded or deleted (`TFIdentifier.update`/`update_many`/`remove`), so the matrices stay in sync with whatever's currently in `data/`. See the `data` branch in [BRANCHES.md](BRANCHES.md) for a related robustness pass on this system.

## Application Routes

| Route | Methods | Purpose |
|---|---|---|
| `/` | GET | Main BindLine analysis page |
| `/dashboard` | GET | Logged-in user's file dashboard |
| `/data` | GET | Public data download page |
| `/help` | GET | In-app documentation |
| `/sequences` | POST | Parse/validate uploaded or pasted sequences |
| `/list-files/<file_type>` | GET | List a user's/public FASTA or score files |
| `/upload` | POST | Upload a FASTA or score file — or, when `search_binding_sites`/`search_significant_mutations` form flags are set, score sequences against a protein and return binding sites (`find_binding_sites`) or enumerate mutants and their effects (`find_significant_mutations`) instead of storing a file |
| `/delete_file/<file_id>` | POST | Delete an uploaded private file of the logged-in user |
| `/bulk` | POST | Bulk action (e.g. delete) over a list of selected files |
| `/download/<file_id>`, `/download-public/<file_id>` | GET | Download a private/public file |
| `/results/<dir_name>/<file_name>` | GET | Download a generated result/export |
| `/download/sample-score`, `/download/sample-fasta` | GET | Download the bundled sample files |
| `/favicon.ico` | GET | Serve the site favicon |
| `/auth/register` | POST | Register a new user |
| `/auth/login` | POST | Log in |
| `/auth/logout` | GET | Log out |
| `/auth/get_uuid` | GET | Current user's uuid (or `null`) |
| `/auth/get_name_by_uuid/<uuid>` | GET | Look up a username by uuid |
| `/files/upload` | POST | Files-blueprint file upload |
| `/files/delete` | POST | Files-blueprint file deletion |
| `/files/get_name_by_uuid/<uuid>` | GET | Files-blueprint uuid → username lookup |
| `/files/get_file` | POST | Look up a file by name |

(Route function names and exact signatures are in `app/app.py`; this table covers the routes present on `main`.)

## Branches & Development Workflow

`main` is the deployed branch. New work branches off `dev`, not off `main` directly:

1. Create a short-lived feature branch off `dev`.
2. Do the work there, then merge it back into `dev`.
3. Once it's been checked out on `dev`, merge `dev` into `main`.
4. Delete the feature branch — and, optionally, `dev` itself — now that its work lives on `main`.

Branches that reach the end of this cycle (or that end up superseded by a later branch) are periodically cleaned up.

Some branches remain ahead of `main` with real, unmerged work:
See **[BRANCHES.md](BRANCHES.md)** for a full breakdown of what each branch adds, which files it touches, and its commit history.
