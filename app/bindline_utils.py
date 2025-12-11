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


def recursive_dir(path):
    path = os.path.abspath(path)
    return [os.path.join(root, file)[len(path)+1:] for root, _, files in os.walk(path) for file in files]


def recursive_dir_under_root(root, path, include_dirname=True):
    files = recursive_dir(os.path.join(root, path))
    if include_dirname:
        return list(map(lambda f: os.path.join(path, f), files))
    else:
        return files


def list_user_score_file_names(username, include_username=True):
    return [f.filename for f in files.list_user_score_files()]
    return recursive_dir_under_root(consts.SCORE_DIR, username, include_dirname=include_username) if username else []


def list_user_fasta_file_names(username, include_username=True):
    return [f.filename for f in files.list_user_fasta_files()]
    return recursive_dir_under_root(consts.FASTA_DIR, username, include_dirname=include_username) if username else []


def list_public_score_file_names(include_username=True):
    return [f.filename for f in files.list_public_score_files()]
    return list_user_score_file_names(consts.PUBLIC_DIR, include_username=include_username)


def list_public_fasta_file_names(include_username=True):
    return [f.filename for f in files.list_public_fasta_files()]
    return list_user_fasta_file_names(consts.PUBLIC_DIR, include_username=include_username)


def list_user_public_score_file_names(username=None):
    return sum(map(lambda fs: [f.filename for f in fs], files.list_user_public_score_files()), [])
    user_files = list_user_score_file_names(username)
    public_files = list_public_score_file_names()
    return user_files, public_files


def list_user_public_score_file_jsons():
    return sum(map(lambda fs: [f.to_public_json() for f in fs], files.list_user_public_score_files()), [])


def list_user_public_fasta_file_names(username=None):
    return sum(map(lambda fs: [f.filename for f in fs], files.list_user_public_fasta_files()), [])
    user_files = list_user_fasta_file_names(username)
    public_files = list_public_fasta_file_names()
    return user_files, public_files


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


def align_sequences_by_name(name, seq):
    name = name.split(' ')[-3:]
    typ = name[-1]
    if typ == 'mutation':
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
    if typ == 'mutation':
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
                mutants[f'{i} {base}->{c} mutation'] = sequence[:i] + c + sequence[i + 1:]
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
    effects = np.zeros((len(sequences[ref_name]), len(letters_to_index)),)
    for name, scores in aligned_scores.items():
        if name == ref_name:
            continue
        mut = name.split(' ')[-3:]
        if mut[-1] != 'mutation':
            continue
        mut_base = mut[-2].split('->')[-1]
        mut_pos = int(mut[-3])
        # for each position, take the max of mer scores
        effects[mut_pos, letters_to_index[mut_base]] = np.array(scores[max(mut_pos-mer+1, 0):mut_pos+1]).max()
    df = pd.DataFrame(columns=['A', 'C', 'G', 'T'])
    ref_seq = sequences[ref_name]
    for i in range(len(ref_seq)):
        df.loc[i] = effects[i] - ref_effect[i]
    mutants_effect = df.to_dict(orient='index')
    mutants_effect = [{k: v for k, v in mutants_effect[pos].items() if k != ref_seq[pos]} for pos in range(len(mutants_effect))]
    return mutants_effect


def find_highest_values_and_binding_sites(aligned_scores, aligned_positions, sequences, ref_name,
                                          selected_threshold, ranks_threshold, table):
    highest_values, binding_sites, gaps, insertions = {}, {}, {}, {}
    selected_threshold = selected_threshold if selected_threshold is not None else -np.inf
    ranks_threshold = table.rank_threshold(ranks_threshold) if ranks_threshold is not None else -np.inf
    for name, scores in aligned_scores.items():
        scores = np.array(scores, dtype=np.float32)
        # highest scores are the ones above the absolute and relative thresholds, if exist
        highest_values[name] = np.where(
            (scores >= selected_threshold) & (scores >= ranks_threshold),
            scores, None
        ).tolist()
        binding_sites[name], gaps[name], insertions[name] = get_binding_sites(
            highest_values[name], align_sequences(sequences[ref_name], sequences[name]), table.mer, aligned_positions[name])

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

