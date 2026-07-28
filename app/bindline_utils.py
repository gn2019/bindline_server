import os
import re
import functools
import numpy as np
import pandas as pd
from Bio.Align import PairwiseAligner
from flask_login import login_required
from numpy.lib.stride_tricks import sliding_window_view

from . import auth
from . import consts
from . import bindline
from . import files


def list_user_public_score_file_jsons():
    return sum(map(lambda fs: [f.to_public_json() for f in fs], files.list_user_public_score_files()), [])


def list_user_public_fasta_file_names():
    return sum(map(lambda fs: [f.filename for f in fs], files.list_user_public_fasta_files()), [])


def list_pfam_jsons():
    return [p.to_json() for p in files.list_pfams()]


def get_insertion_fractions(num_of_fractions, base_index):
    return [base_index + (i + 1) / (num_of_fractions + 1) for i in range(num_of_fractions)]


def get_x_vals_from_aligned_seq(aligned_seq):
    x_vals = []
    next_int = 0
    lower_count = 0

    for char in aligned_seq:
        if char.isupper() or char == '-':
            if lower_count > 0:
                x_vals.extend(get_insertion_fractions(lower_count, next_int - 1))
                lower_count = 0
            x_vals.append(next_int)
            next_int += 1
        else:
            lower_count += 1

    if lower_count > 0:
        x_vals.extend(get_insertion_fractions(lower_count, next_int - 1))

    return x_vals


@functools.lru_cache(maxsize=128)
def align_sequences(ref_seq, seq):
    aligner = PairwiseAligner()
    aligner.match_score = 2
    aligner.mismatch_score = -1
    aligner.target_open_gap_score = -1e6  # Extremely high penalty for opening gaps in the reference
    aligner.target_extend_gap_score = -1e6  # Extremely high penalty for extending gaps in the reference
    aligner.query_open_gap_score = -0.5
    aligner.query_extend_gap_score = -0.1
    alignments = aligner.align(ref_seq, seq)
    # in places the ref is -, turn the seq to lowercase
    aligned_seq = ''.join([c.lower() if alignments[0][0][i] == '-' else c for i, c in enumerate(alignments[0][1])])
    return aligned_seq


def align_scores(ref_seq, seq, scores):
    aligned_seq = align_sequences(ref_seq, seq)
    # return the scores with gaps in the same positions
    aligned_scores = []
    j = 0
    for i in range(len(scores) + len(aligned_seq) - len(seq)):
        is_gap = aligned_seq[i] == '-'
        aligned_scores.append(None if is_gap or j >= len(scores) else scores[j])
        j += int(not is_gap)
    aligned_pos = get_x_vals_from_aligned_seq(aligned_seq)
    return aligned_seq, aligned_pos, aligned_scores


@functools.lru_cache(maxsize=4**8)
def align_sequences_by_name(name, seq):
    name = name.split(' ')[-3:]
    typ = name[-1]
    if typ == 'substitution':
        return seq
    if typ == 'insertion':
        pos = int(name[-3])
        # lower the letter in the position of the insertion
        return seq[:pos] + seq[pos].lower() + seq[pos+1:]
    elif typ == 'deletion':
        pos = int(name[-2])
        return seq[:pos] + '-' + seq[pos:]
    raise ValueError("Invalid mutation type.")


def align_scores_by_name(name, seq, scores):
    name = name.split(' ')[-3:]
    typ = name[-1]
    aligned_pos = list(range(len(seq)))
    if typ == 'substitution':
        return seq, aligned_pos, list(scores)
    elif typ == 'insertion':
        pos = int(name[-3])
        aligned_pos.insert(pos, pos - 0.5)
        return seq, aligned_pos, list(scores)
    elif typ == 'deletion':
        pos = int(name[-2])
        aligned_pos.append(len(aligned_pos))
        # concat the scores with None in the position of the deletion
        return seq[:pos] + '-' + seq[pos:], aligned_pos, list(scores[:pos]) + [None] + list(scores[pos:])
    raise ValueError("Invalid mutation type.")


def get_score_file_from_stream(score_stream, file_type):
    if file_type == consts.ESCORE:
        return  bindline.UniProbeEScoreFile(score_stream.read())
    if file_type == consts.ZSCORE:
        return  bindline.UniProbeZScoreFile(score_stream.read())
    if file_type == consts.ISCORE:
        return bindline.UniProbeIScoreFile(score_stream.read())
    raise ValueError("Invalid file type selected.")


def get_score_file(score_path, file_type):
    # if is stream, read directly
    if hasattr(score_path, 'read'):
        return get_score_file_from_stream(score_path, file_type)
    with open(score_path, 'r') as f:
        return get_score_file_from_stream(f, file_type)


def float_or_none(value):
    return float(value) if value is not None else None


@functools.lru_cache(maxsize=1000)
def get_score_table(file_path, file_type):
    return next(get_score_file(file_path, file_type).parse_tables())


def get_public_matrix_path(filename):
    return os.path.join(consts.SCORE_DIR, consts.PUBLIC_DIR, filename)


@login_required
def get_user_matrix_path(name, ranks=False):
    if ranks:
        dirname = consts.ESCORE_RANKS
    else:
        dirname = {
            consts.ESCORE: consts.ESCORE,
            consts.ZSCORE: consts.ZSCORE,
            consts.ISCORE: consts.ISCORE,
        }[name]
    path = os.path.join(consts.SCORE_DIR, auth.get_current_user_uuid(), consts.IDENTIFIERS_DIR, dirname)
    return path


def get_user_matrix_path_if_exists(*args, **kwargs):
    path = get_user_matrix_path(*args, **kwargs)
    return path if os.path.exists(path) else None

def get_thresholds(request):
    file_type = request.form.get('file_type')
    escore_threshold = float_or_none(request.form.get('escore_threshold_input'))
    iscore_threshold = float_or_none(request.form.get('iscore_threshold_input'))
    zscore_threshold = float_or_none(request.form.get('zscore_threshold_input'))
    ranks_threshold = float_or_none(request.form.get('ranks_threshold_input'))
    selected_threshold = {consts.ESCORE: escore_threshold, consts.ISCORE: iscore_threshold, consts.ZSCORE: zscore_threshold}[file_type]
    return selected_threshold, ranks_threshold


def get_all_point_mutations(sequence):
    mutants = {}
    for i, base in enumerate(sequence):
        for c in consts.DNA_BASES:
            if base != c:
                mutants[f'{i} {base}->{c} substitution'] = sequence[:i] + c + sequence[i + 1:]
    return mutants


def get_all_insertions(sequence):
    mutants = {f'0 {c} insertion': c + sequence for c in consts.DNA_BASES}
    for i, base in enumerate(sequence):
        for c in consts.DNA_BASES:
            if base != c:
                mutants[f'{i+1} {c} insertion'] = sequence[:i+1] + c + sequence[i+1:]
    return mutants


def get_all_deletions(sequence):
    mutants = {}
    for i, base in enumerate(sequence):
        mutants[f'{i} deletion'] = sequence[:i] + sequence[i + 1:]
    return mutants


def get_all_mutants(name, sequence):
    mutants = {name: sequence}
    for suffix, seq in get_all_point_mutations(sequence).items():
        mutants[f'{name}: {suffix}'] = seq
    for suffix, seq in get_all_insertions(sequence).items():
        mutants[f'{name}: {suffix}'] = seq
    for suffix, seq in get_all_deletions(sequence).items():
        mutants[f'{name}: {suffix}'] = seq
    return mutants


class BindingSiteParams:
    START, END, SEQ, BS_START, BS_END, IS_ADDED = range(6)


def does_equivalent_bs_exist(bs, binding_sites):
    return (bs[BindingSiteParams.SEQ].replace('-', '') in map(lambda x: x[BindingSiteParams.SEQ], binding_sites) or
            ((bs[BindingSiteParams.START], bs[BindingSiteParams.END]) in
             map(lambda x: (x[BindingSiteParams.START], x[BindingSiteParams.END]), binding_sites)))


def sliding_max(scores, mer):
    scores = np.pad(scores, (mer-1, mer-1), mode="constant", constant_values=-np.inf)
    return np.max(sliding_window_view(scores, window_shape=mer), axis=1)


def get_all_mutants_effect(aligned_scores, sequences, ref_name, mer):
    ref_scores = aligned_scores[ref_name]
    ref_effect = sliding_max(ref_scores, mer)

    letters_to_index = {'A': 0, 'C': 1, 'G': 2, 'T': 3}
    effects = np.zeros((len(sequences[ref_name]), len(letters_to_index)), dtype=np.float16)
    for name, scores in aligned_scores.items():
        if name == ref_name:
            continue
        mut = name.split(' ')[-3:]
        if mut[-1] != 'substitution':
            continue
        mut_base = mut[-2].split('->')[-1]
        mut_pos = int(mut[-3])
        # for each position, take the max of mer scores
        effects[mut_pos, letters_to_index[mut_base]] = max(scores[max(mut_pos-mer+1, 0):mut_pos+1])
    df = pd.DataFrame(columns=['A', 'C', 'G', 'T'])
    ref_seq = sequences[ref_name]
    for i in range(len(ref_seq)):
        df.loc[i] = effects[i] - ref_effect[i]
    mutants_effect = df.to_dict(orient='index')
    mutants_effect = [{k: v for k, v in mutants_effect[pos].items() if k != ref_seq[pos]} for pos in range(len(mutants_effect))]
    return mutants_effect, ref_effect.tolist()


def find_highest_values_and_binding_sites(aligned_scores, aligned_positions, sequences, ref_name,
                                          selected_threshold, ranks_threshold, table, point_mutations_only=False):
    highest_values, binding_sites, gaps, insertions = {}, {}, {}, {}
    selected_threshold = selected_threshold if selected_threshold is not None else -np.inf
    ranks_threshold = table.rank_threshold(ranks_threshold) if ranks_threshold is not None else -np.inf
    for name, scores in aligned_scores.items():
        scores = np.array(scores, dtype=np.float16)
        # Threshold equation: keep k-mers where (score >= AbsoluteThreshold) AND (score >= RankPercentile)
        # RankPercentile is the score value at the top X% of all scores
        highest_values[name] = np.where(
            (scores >= selected_threshold) & (scores >= ranks_threshold),
            scores, None
        ).tolist()
        if name != ref_name:
            aligned_seq = align_sequences_by_name(name, sequences[name]) if point_mutations_only else align_sequences(sequences[ref_name], sequences[name])
        else:
            aligned_seq = sequences[name]
        binding_sites[name], gaps[name], insertions[name] = get_binding_sites(
            highest_values[name], aligned_seq, table.mer, aligned_positions[name])

    return highest_values, binding_sites, gaps, insertions


def show_diff_only(binding_sites, ref_name):
    for protein_file in binding_sites:
        for input_seq in binding_sites[protein_file]:
            if input_seq != ref_name:
                ref = binding_sites[protein_file][ref_name]
                com = binding_sites[protein_file][input_seq]
                added = [bs for bs in com if not does_equivalent_bs_exist(bs, ref)]
                removed = [tuple(bs[:-1] + (False,)) for bs in ref if not does_equivalent_bs_exist(bs, com)]  # false means it removed
                binding_sites[protein_file][input_seq] = added + removed
        # Delete the reference bs dict
        binding_sites[protein_file][ref_name] = []


def parse_mpra_dataframe(df):
    """
    Parse an MPRA CSV/TSV dataframe with columns: Position, Ref, Alt, Value, and
    optionally P-Value. Returns (ref_sequence, variants) where variants is a list of
    dicts with 0-based position (relative to the start of the reference), ref, alt,
    value and p_value (or None).
    """
    required = {'Position', 'Ref', 'Alt', 'Value'}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Missing required column(s): {', '.join(sorted(missing))}")

    df = df.copy()
    df['Ref'] = df['Ref'].astype(str).str.strip().str.upper()
    df['Alt'] = df['Alt'].astype(str).str.strip().str.upper()
    has_pvalue = 'P-Value' in df.columns

    positions = df[['Position', 'Ref']].drop_duplicates().sort_values('Position')
    min_pos, max_pos = int(positions['Position'].min()), int(positions['Position'].max())
    expected = set(range(min_pos, max_pos + 1))
    missing_pos = sorted(expected - set(positions['Position'].astype(int).tolist()))
    if missing_pos:
        raise ValueError(f"Missing positions in the reference sequence: {missing_pos}")

    ref_sequence = ''.join(positions['Ref'].tolist())

    variants = []
    for _, row in df.iterrows():
        value = row['Value']
        p_value = row['P-Value'] if has_pvalue else None
        variants.append({
            'position': int(row['Position']) - min_pos,
            'ref': row['Ref'],
            'alt': row['Alt'],
            'value': float(value) if pd.notna(value) else None,
            'p_value': float(p_value) if p_value is not None and pd.notna(p_value) else None,
        })
    return ref_sequence, variants


def build_mpra_exp_matrix(ref_sequence, variants):
    """
    Build the (len(ref_sequence), 3) experimental effect matrix used for correlating
    against predicted TF effects: for each position, the Value of each of the 3
    non-reference bases, in ACGT order (excluding whichever base is the reference).
    """
    letters_to_index = {'A': 0, 'C': 1, 'G': 2, 'T': 3}
    exp_matrix = np.zeros((len(ref_sequence), 4), dtype=np.float16)
    for v in variants:
        if v['alt'] not in letters_to_index or v['value'] is None:
            continue
        exp_matrix[v['position'], letters_to_index[v['alt']]] = v['value']

    filtered = []
    for i, row in enumerate(exp_matrix):
        ref = ref_sequence[i]
        if ref not in letters_to_index:
            raise ValueError(f"Invalid reference base '{ref}' at position {i} of the reference sequence.")
        row = row.tolist()
        row.pop(letters_to_index[ref])
        filtered.append(row)
    return np.vstack(filtered)


def tf_window_hits(E, seq, T, w=5, thr=0.85, var_thr=0.35, k=8, alpha=0.3):
    """
    Slide a window of size `w` across `seq` and, for every TF row in the k-mer score
    matrix `E` (TFs x 4^k), compute a magnitude-weighted correlation between the
    TF's predicted per-base mutation effect and the experimental effect matrix `T`
    (len(seq) x 3, ACGT order excluding the reference base per position).

    Threshold equations:
    - Correlation threshold: |magnitude-weighted correlation| >= thr (default 0.85)
    - Effect magnitude threshold: max(|predicted effect|) >= var_thr (default 0.35)
    - Alpha parameter: weight factor for correlation calculation (default 0.3)

    Returns a list of (row_index_in_E, window_start_positions, correlation_scores)
    for TFs that have at least one window passing both the correlation and effect
    magnitude thresholds.
    """
    base = {'A': 0, 'C': 1, 'G': 2, 'T': 3}
    s = np.fromiter((base[c] for c in seq), dtype=np.int8)
    n = s.size
    m = E.shape[0]

    if n < k or n < w:
        return []

    # --- rolling k-mer indices ---
    pows = (4 ** np.arange(k - 1, -1, -1)).astype(np.int64)
    kidx = np.empty(n - k + 1, dtype=np.int64)
    idx = (s[:k] * pows).sum()
    kidx[0] = idx
    for i in range(1, n - k + 1):
        idx = (idx - s[i - 1] * pows[0]) * 4 + s[i + k - 1]
        kidx[i] = idx

    # scores along sequence (m, n-k+1)
    S = E[:, kidx]

    # --- starts per position ---
    starts = [np.arange(max(0, i - (k - 1)), min(i, n - k) + 1) for i in range(n)]

    # --- original max per position ---
    orig = np.empty((m, n), dtype=E.dtype)
    for i, js in enumerate(starts):
        if js.size:
            orig[:, i] = S[:, js].max(axis=1)
        else:
            orig[:, i] = 0

    # --- precompute delta ---
    delta = (np.arange(4)[None, :, None] - np.arange(4)[:, None, None]) * pows[None, None, :]

    effects = np.empty((m, n, 3), dtype=E.dtype)

    for i in range(n):
        js = starts[i]
        if js.size == 0:
            effects[:, i, :] = 0
            continue

        offs = i - js
        base_idx = kidx[js]
        ref = int(s[i])

        alts = np.array([0, 1, 2, 3], dtype=np.int8)
        alts = alts[alts != ref]

        d = delta[ref, alts][:, offs]       # (3, len_js)
        idxs = base_idx[None, :] + d        # (3, len_js)

        Smut = E[:, idxs]                   # (m, 3, len_js)
        alt_max = Smut.max(axis=2)          # (m, 3)

        effects[:, i, :] = alt_max - orig[:, i][:, None]

    # --- sliding correlation with magnitude-weighted sign gain ---
    L = 3 * w
    if n - w + 1 <= 0:
        return []

    Tw = sliding_window_view(T, (w, 3)).reshape(n - w + 1, L).copy()
    Tw_z = (Tw - Tw.mean(axis=1, keepdims=True)) / (Tw.std(axis=1, keepdims=True) + 1e-8)

    Ew_all = sliding_window_view(effects, (1, w, 3)).copy()
    Ew_all = Ew_all.reshape(m, n - w + 1, L)
    Ew_z = (Ew_all - Ew_all.mean(axis=2, keepdims=True)) / (Ew_all.std(axis=2, keepdims=True) + 1e-8)

    r = (Ew_z * Tw_z[None, :, :]).mean(axis=2)   # (m, n-w+1)

    wgt = np.abs(Tw[None, :, :])
    sign_agree = np.sign(Ew_all * Tw[None, :, :])
    sign_score = (sign_agree * wgt).sum(axis=2) / (wgt.sum(axis=2) + 1e-8)
    score = r + alpha * np.abs(sign_score)

    altmax_all = effects + orig[:, :, None]
    Aw = sliding_window_view(altmax_all, (1, w, 3)).reshape(m, n - w + 1, w, 3)
    var_ok = (Aw.max(axis=(2, 3)) > var_thr)

    mask = (score >= thr) & var_ok

    hits = []
    for t in range(m):
        pos = np.where(mask[t])[0]
        if pos.size:
            hits.append((t, pos, r[t, pos]))

    return hits


def get_pfam_map(score_file_ids):
    """
    return a map from pfam_name to protein files
    """
    pfam_map = {}
    for file_id in score_file_ids:
        pfam_ids = files.get_pfam_ids(file_id)
        if not pfam_ids:
            filename = files.get_file_by_id(file_id).filename
            pfam_map.setdefault(filename, []).append(filename)
        for pfam_id in pfam_ids:
            pfam_map.setdefault(files.get_pfam_name(pfam_id), []).append(files.get_file_by_id(file_id).filename)
    return pfam_map


def get_binding_sites(highest_values, seq, mer, aligned_positions):
    # indices of the not None values in curr_highest_values[name], by numpy
    bs = [i for i, value in enumerate(highest_values) if value is not None]
    # for each binding site, get the start and end indices
    # if there's a gap inside, calculate it
    # if there are multiple binding sites in a row, merge them
    curr_binding_sites = []
    curr_gaps, curr_insertions = [], []
    for i in range(len(bs)):
        if i == 0 or (bs[i] - bs[i - 1] > 1 and any(c != '-' for c in seq[bs[i - 1] + 1:bs[i]])):
            start = bs[i]
        if i == len(bs) - 1 or (bs[i + 1] - bs[i] > 1 and any(c != '-' for c in seq[bs[i] + 1:bs[i + 1]])):
            end = bs[i]
            # count (mer - 1) non-gaps after the end
            remain = mer - 1
            for c in seq[end + 1:]:
                end += 1
                if c != '-':
                    remain -= 1
                    if remain == 0:
                        break
            bs_seq = seq[start:end + 1]
            bs_start = len(seq[:start].replace('-', ''))  # start index in the original sequence
            bs_end = bs_start + len(bs_seq.replace('-', '')) - 1
            curr_binding_sites.append(
                (aligned_positions[start], aligned_positions[end], bs_seq, bs_start, bs_end, True))
            # add to curr_gaps all the '-' indices inside (start, end) intervals
            curr_gaps += get_gaps(seq, start, end, aligned_positions)
            curr_insertions += get_insertions(seq, start, end, aligned_positions)
    return curr_binding_sites, curr_gaps, curr_insertions


def get_gaps(seq, start, end, aligned_positions):
    # return start and end of '-' sequences in seq the interval [start, end]
    # previous: return [aligned_positions[i] for i in range(start, end + 1) if seq[i] == '-']
    return [(aligned_positions[match.start() + start], aligned_positions[match.end() + start - 1])
            for match in re.finditer(r'-+', seq[start:end + 1])]


def get_insertions(seq, start, end, aligned_positions):
    # return start and end of lowercase sequences in seq the interval [start, end]
    # previous: return [(aligned_positions[i], seq[i]) for i in range(start, end + 1) if seq[i].islower()]
    return [(
        (aligned_positions[match.start() + start] + aligned_positions[match.end() + start - 1]) / 2,
        seq[match.start() + start:match.end() + start].upper())
            for match in re.finditer(r'[a-z]+', seq[start:end + 1])]


def compute_full_sequence_correlation(ref_sequence, exp_matrix, ref_effect, window_size, alpha=0.3):
    """
    Compute sliding-window correlation across the full sequence.
    Returns (positions, correlation_values) where:
    - positions: list of window start positions
    - correlation_values: list of correlation scores for each window

    Uses the same correlation metric as tf_window_hits (magnitude-weighted sign agreement + Pearson r).
    """
    exp_matrix = np.array(exp_matrix, dtype=np.float32)
    ref_effect = np.array(ref_effect, dtype=np.float32)

    n = len(ref_sequence)
    w = window_size

    if n < w:
        return [], []

    # Extract sliding windows of MPRA effects (shape: (n-w+1, w*3))
    L = 3 * w
    Tw = sliding_window_view(exp_matrix, (w, 3)).reshape(n - w + 1, L).copy()
    Tw_z = (Tw - Tw.mean(axis=1, keepdims=True)) / (Tw.std(axis=1, keepdims=True) + 1e-8)

    # Compute predicted effects per position (from ref_effect sliding window)
    # ref_effect is shape (n,), we take sliding windows of size w
    ref_effect_windows = sliding_window_view(ref_effect, w).copy()  # (n-w+1, w)

    # Expand to (n-w+1, w, 3) to match dimensions (broadcast across nucleotides)
    ref_effect_expanded = np.repeat(ref_effect_windows[:, :, np.newaxis], 3, axis=2)  # (n-w+1, w, 3)
    ref_effect_flat = ref_effect_expanded.reshape(n - w + 1, L)  # (n-w+1, L)
    ref_effect_z = (ref_effect_flat - ref_effect_flat.mean(axis=1, keepdims=True)) / (ref_effect_flat.std(axis=1, keepdims=True) + 1e-8)

    # Compute Pearson correlation per window
    r = (ref_effect_z * Tw_z).mean(axis=1)  # (n-w+1,)

    # Compute sign agreement score
    wgt = np.abs(Tw)  # (n-w+1, L)
    sign_agree = np.sign(ref_effect_expanded.reshape(n - w + 1, L) * Tw)  # (n-w+1, L)
    sign_score = (sign_agree * wgt).sum(axis=1) / (wgt.sum(axis=1) + 1e-8)  # (n-w+1,)

    # Combined score
    score = r + alpha * np.abs(sign_score)  # (n-w+1,)

    # Return positions (window starts) and scores
    positions = list(range(n - w + 1))
    correlation_values = score.tolist()

    return positions, correlation_values
