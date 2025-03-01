import functools
import re

import pandas as pd
from flask import Flask, render_template, request, jsonify, Response
from flask_cors import CORS
from Bio.Align import PairwiseAligner
import json
import os
import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

import bindline
import consts

app = Flask(__name__)
CORS(app)
app.config['UPLOAD_FOLDER'] = consts.UPLOAD_DIR
app.config['FASTA_FOLDER'] = consts.FASTA_DIR
app.config['ESCORE_FOLDER'] = consts.ESCORE_DIR

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['FASTA_FOLDER'], exist_ok=True)
os.makedirs(app.config['ESCORE_FOLDER'], exist_ok=True)

escore_identifier = bindline.TFIdentifier(absolute_hypo_file=consts.ESCORE_MATRIX_PKL,
                                          rank_hypo_file=consts.ESCORE_RANK_MATRIX_PKL)
zscore_identifier = bindline.TFIdentifier(absolute_hypo_file=consts.ZSCORE_MATRIX_PKL,
                                          rank_hypo_file=consts.ESCORE_RANK_MATRIX_PKL)
iscore_identifier = bindline.TFIdentifier(absolute_hypo_file=consts.ISCORE_MATRIX_PKL,
                                          rank_hypo_file=consts.ESCORE_RANK_MATRIX_PKL)


def recursive_dir(path):
    path = os.path.abspath(path)
    return [os.path.join(root, file)[len(path)+1:] for root, _, files in os.walk(path) for file in files]


# List existing files in the upload directory
@app.route('/list-files/<filetype>', methods=['GET'])
def list_files(filetype):
    # fasta files in "fasta" directory, escore files in "escore" directory
    if filetype == 'fasta':
        files = recursive_dir(app.config['FASTA_FOLDER'])
    elif filetype == 'escore':
        files = recursive_dir(app.config['ESCORE_FOLDER'])
    else:
        files = []
    return jsonify(files)


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
    name = name.split('_')[-1]
    typ = name[0]
    if typ == 'm':
        return seq
    if typ == 'i':
        pos = int(name[1:-1])
        # lower the letter in the position of the insertion
        return seq[:pos] + seq[pos].lower() + seq[pos+1:]
    if typ == 'd':
        pos = int(name[1:])
        return seq[:pos] + '-' + seq[pos:]
    raise ValueError("Invalid mutation type.")


def align_scores_by_name(name, seq, scores):
    name = name.split('_')[-1]
    typ = name[0]
    aligned_pos = list(range(len(seq)))
    if typ == 'm':
        return seq, aligned_pos, list(scores)
    elif typ == 'i':
        pos = int(name[1:-1])
        aligned_pos.insert(pos, pos - 0.5)
        return seq, aligned_pos, list(scores)
    elif typ == 'd':
        pos = int(name[1:])
        aligned_pos.append(len(aligned_pos))
        # concat the scores with None in the position of the deletion
        return seq[:pos] + '-' + seq[pos:], aligned_pos, list(scores[:pos]) + [None] + list(scores[pos:])
    raise ValueError("Invalid mutation type.")


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/sequences', methods=['POST'])
def get_sequences():
    fasta_file = request.files.get('fasta')  # Get uploaded file, if any
    existing_fasta = request.form.get('existing_fasta')  # Get existing file if selected

    # Determine the FASTA file to use
    if fasta_file:
        fasta_path = os.path.join(app.config['FASTA_FOLDER'], fasta_file.filename)
        fasta_file.save(fasta_path)  # Save the uploaded file
    elif existing_fasta:
        fasta_path = os.path.join(app.config['FASTA_FOLDER'], existing_fasta)
    else:
        return jsonify({'error': 'No FASTA file provided.'}), 400

    try:
        # Extract sequences from the FASTA file using bindline
        sequences = bindline.get_seqs_from_fasta(fasta_path)
    except Exception as e:
        # Log the exception and print stack trace
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

    return jsonify({'sequences': sequences})


def get_score_file(score_path, file_type):
    with open(score_path, 'r') as f:
        if file_type == 'escore':
            score = bindline.UniProbeEScoreFile(f.read())
        elif file_type == 'zscore':
            score = bindline.UniProbeZScoreFile(f.read())
        elif file_type == 'iscore':
            score = bindline.UniProbeIScoreFile(f.read())
        else:
            raise ValueError("Invalid file type selected.")
    return score


def float_or_none(value):
    return float(value) if value is not None else None


def get_identifier_by_type(file_type):
    if file_type == 'escore':
        return escore_identifier
    elif file_type == 'zscore':
        return zscore_identifier
    elif file_type == 'iscore':
        return iscore_identifier
    else:
        raise ValueError("Invalid file type selected.")


@functools.lru_cache(maxsize=1000)
def get_score_table(file_path, file_type):
    return next(get_score_file(file_path, file_type).parse_tables())


def get_thresholds(request):
    file_type = request.form['file_type']
    escore_threshold = float_or_none(request.form.get('escore_threshold_input'))
    iscore_threshold = float_or_none(request.form.get('iscore_threshold_input'))
    zscore_threshold = float_or_none(request.form.get('zscore_threshold_input'))
    ranks_threshold = float_or_none(request.form.get('ranks_threshold_input'))
    selected_threshold = {'escore': escore_threshold, 'iscore': iscore_threshold, 'zscore': zscore_threshold}[file_type]
    return selected_threshold, ranks_threshold


@app.route('/find-binding-sites', methods=['GET'])
def find_binding_sites():
    file_type = request.form['file_type']
    sequences = json.loads(request.form.get('sequences'))
    selected_threshold, ranks_threshold = get_thresholds(request)
    ref_name = request.form['ref_name']
    # identify by both identifiers, and combine
    identifier = get_identifier_by_type(file_type)
    identified_TFs = identifier(sequences, absolute_threshold=selected_threshold, rank_threshold=ranks_threshold)

    # Extract unique file paths of identified TFs
    # identified_TFs[seq_name] is a tuple where first value is the sequence
    # and the second is the list of lists of file paths
    identified_unq_files = sum(sum(map(lambda s: s[1], identified_TFs.values()), []), [])

    # Get the tables for each identified file
    identified_tables = {}
    identified_binding_sites = {}
    for file in identified_unq_files:
        file_path = os.path.join(app.config['ESCORE_FOLDER'], file)
        _, _, identified_tables[file] = get_score_table(file_path, file_type)
        score = identified_tables[file].score_seqs(sequences)

        identified_binding_sites[file] = {}
        for seq_name in identified_TFs:
            curr_bs = [score[seq_name][1][i] if file in pos_ls else None
                       for i, pos_ls in enumerate(identified_TFs[seq_name][1])]
            _, _, identified_binding_sites[file][seq_name] = align_scores(sequences[ref_name], sequences[seq_name], curr_bs)

    # Compute the scores for each identified transcription factor (TF) across all sequences.
    # The dictionary has the following structure:
    # {
    #   identified file path 1: {
    #       seq name 1: (sequence, array of scores),
    #       seq name 2: (sequence, array of scores)
    #   },
    #   identified file path 2: {
    #       seq name 1: (sequence, array of scores),
    #       seq name 2: (sequence, array of scores)
    #   }
    # }
    max_scores = {}
    identified_scores = {}
    binding_sites, gaps, insertions = {}, {}, {}
    aligned_seqs = {}
    aligned_positions = {}

    for score_file, table in identified_tables.items():
        scores_dict = table.score_seqs(sequences)
        max_scores[score_file] = table.max_score()
        identified_scores[score_file] = curr_aligned_scores = {}
        ref_seq, ref_scores = scores_dict[ref_name]

        binding_sites[score_file] = curr_binding_sites = {}
        gaps[score_file] = curr_gaps = {}
        insertions[score_file] = curr_insertions = {}
        for name, (sequence_str, sequence_scores) in scores_dict.items():
            # curr_aligned_scores[name] = align_sequences(ref_scores, sequence_scores)
            aligned_seqs[name], aligned_positions[name], curr_aligned_scores[name] = (
                align_scores(ref_seq, sequence_str, sequence_scores))
            curr_binding_sites[name], curr_gaps[name], curr_insertions[name] = (
                get_binding_sites(identified_binding_sites[score_file][name],
                                  aligned_seqs[name], table.mer, aligned_positions[name]))

    if request.form['show_diff_only'] == 'true':
        show_diff_only(binding_sites, ref_name)
        # remove the sequences that have no binding sites except of the ref
        for file, bss in binding_sites.items():
            for seq_name, bs in bss.items():
                if seq_name != ref_name and len(bs) == 0:
                    del identified_scores[file][seq_name], identified_binding_sites[file][seq_name], gaps[file][seq_name]
            binding_sites[file] = {k: v for k, v in bss.items() if v and k != ref_name}
            if not binding_sites[file]:
                del identified_scores[file], identified_binding_sites[file], gaps[file], max_scores[file]
        binding_sites = {k: v for k, v in binding_sites.items() if v}

    plot_data = {
        'ref_name': ref_name,
        'sequence_strs': sequences,
        'aligned_seqs': aligned_seqs,
        'aligned_scores': identified_scores,
        'aligned_positions': aligned_positions,
        'max_scores': max_scores,
        'binding_sites': binding_sites,
        'highest_values': identified_binding_sites,
        'insertions': insertions,
        'gaps': gaps,
    }

    print(plot_data)

    return Response(
        json.dumps(plot_data, allow_nan=False),
        mimetype='application/json'
    )


def get_all_point_mutations(sequence):
    mutants = {}
    for i, base in enumerate(sequence):
        for c in consts.DNA_BASES:
            if base != c:
                mutants[f'm{i}{c}'] = sequence[:i] + c + sequence[i + 1:]
    return mutants


def get_all_insertions(sequence):
    mutants = {f'i0{c}': c + sequence for c in consts.DNA_BASES}
    for i, base in enumerate(sequence):
        for c in consts.DNA_BASES:
            if base != c:
                mutants[f'i{i+1}{c}'] = sequence[:i+1] + c + sequence[i+1:]
    return mutants


def get_all_deletions(sequence):
    mutants = {}
    for i, base in enumerate(sequence):
        mutants[f'd{i}'] = sequence[:i] + sequence[i + 1:]
    return mutants


def get_all_mutants(name, sequence):
    mutants = {name: sequence}
    for suffix, seq in get_all_point_mutations(sequence).items():
        mutants[f'{name}_{suffix}'] = seq
    for suffix, seq in get_all_insertions(sequence).items():
        mutants[f'{name}_{suffix}'] = seq
    for suffix, seq in get_all_deletions(sequence).items():
        mutants[f'{name}_{suffix}'] = seq
    return mutants


def get_score_files(request):
    if 'e_score' in request.files and request.files.getlist('e_score')[0].filename:
        # save them (it's a list of files)
        score_files = request.files.getlist('e_score')
        for score_file in score_files:
            score_path = os.path.join(app.config['ESCORE_FOLDER'], score_file.filename)
            score_file.save(score_path)
        # take their names
        return [f.filename for f in score_files]
    else:
        return [request.form[var] for var in request.form if var.startswith('e_score_')]


class BindingSiteParams:
    START, END, SEQ, BS_START, BS_END, IS_ADDED = range(6)


def does_equivalent_bs_exist(bs, binding_sites):
    return (bs[BindingSiteParams.SEQ].replace('-', '') in map(lambda x: x[BindingSiteParams.SEQ], binding_sites) or
            ((bs[BindingSiteParams.START], bs[BindingSiteParams.END]) in
             map(lambda x: (x[BindingSiteParams.START], x[BindingSiteParams.END]), binding_sites)))


def find_significant_mutations():
    file_type = request.form['file_type']
    sequences = json.loads(request.form.get('sequences'))
    assert len(sequences) == 1, "Only one sequences are allowed for this analysis."  # checked in js
    selected_threshold, ranks_threshold = get_thresholds(request)
    assert selected_threshold is not None or ranks_threshold is not None, \
        "Either score or rank threshold must be provided."   # checked in js

    ref_name = request.form['ref_name']
    sequences = get_all_mutants(*next(iter(sequences.items())))
    score_files = get_score_files(request)

    aligned_scores = {}
    aligned_seqs = {}
    aligned_positions = {}
    highest_values = {}
    max_scores = {}
    binding_sites = {}
    gaps, insertions = {}, {}

    for score_file in score_files:
        score_path = os.path.join(app.config['ESCORE_FOLDER'], score_file)

        name, motif, table = get_score_table(score_path, file_type)
        scores_dict = table.score_seqs(sequences)

        max_scores[score_file] = table.max_score()
        aligned_scores[score_file] = curr_aligned_scores = {}

        for name, (sequence_str, sequence_scores) in scores_dict.items():
            if name == ref_name:
                aligned_seqs[name], aligned_positions[name], curr_aligned_scores[name] = sequence_str, list(range(len(sequences[name]))), list(sequence_scores)
            else:
                aligned_seqs[name], aligned_positions[name], curr_aligned_scores[name] = align_scores_by_name(name, sequence_str, sequence_scores)

        highest_values[score_file], binding_sites[score_file], gaps[score_file], insertions[score_file] = find_highest_values_and_binding_sites(
            aligned_scores[score_file], aligned_positions, sequences, ref_name, selected_threshold, ranks_threshold, table)

        # reduce binding sites
        # leave only one occurrence of each threesome
        bs_set = set()
        for name in binding_sites[score_file]:
            indices_to_remove = []
            for i, bs in enumerate(binding_sites[score_file][name]):
                if bs[BindingSiteParams.SEQ].replace('-', '') in bs_set:
                    indices_to_remove.append(i)
                else:
                    bs_set.add(bs[BindingSiteParams.SEQ])
            for i in reversed(indices_to_remove):
                del binding_sites[score_file][name][i]

        # create MPRA-like data
        mutants_effect = get_all_mutants_effect(aligned_scores[score_file], sequences, ref_name, mer=table.mer)

        curr_binding_sites = binding_sites[score_file]
        for name in sequences.keys():
            if name == ref_name:
                continue
            indices_to_remove = []
            for i, bs in enumerate(curr_binding_sites[name]):
                if does_equivalent_bs_exist(bs, binding_sites[score_file][ref_name]):
                    indices_to_remove.append(i)
            if len(indices_to_remove) == len(curr_binding_sites[name]):
                # remove from all dicts
                del aligned_scores[score_file][name]
                del highest_values[score_file][name], binding_sites[score_file][name], gaps[score_file][name], insertions[score_file][name]
            else:
                # remove only the equivalent binding sites
                for i in reversed(indices_to_remove):
                    del curr_binding_sites[name][i]

    plot_data = {
        'ref_name': ref_name,
        'sequence_strs': sequences,
        'aligned_seqs': aligned_seqs,
        'aligned_scores': aligned_scores,
        'aligned_positions': aligned_positions,
        'max_scores': max_scores,
        'highest_values': highest_values,
        'binding_sites': binding_sites,
        'insertions': insertions,
        'gaps': gaps,
        'mutants_effect': mutants_effect,
    }

    return Response(
        json.dumps(plot_data, allow_nan=False),
        mimetype='application/json'
    )


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
        mut = name.split('_')[-1]
        if mut[0] != 'm':
            continue
        mut_base = mut[-1]
        mut_pos = int(mut[1:-1])
        # for each position, take the max of mer scores
        effects[mut_pos, letters_to_index[mut_base]] = np.array(scores[max(mut_pos-mer+1, 0):mut_pos+1]).max()
    df = pd.DataFrame(columns=['A', 'C', 'G', 'T'])
    ref_seq = sequences[ref_name]
    for i in range(len(ref_seq)):
        df.loc[i] = effects[i] - ref_effect[i]
    mutants_effect = df.to_dict(orient='index')
    mutants_effect = [{k: v for k, v in mutants_effect[pos].items() if k != ref_seq[pos]} for pos in range(len(mutants_effect))]
    return mutants_effect


@app.route('/upload', methods=['POST'])
def upload_files():
    if request.form['search_binding_sites'] == 'true':
        return find_binding_sites()
    if request.form['search_significant_mutations'] == 'true':
        return find_significant_mutations()

    file_type = request.form['file_type']
    sequences = json.loads(request.form.get('sequences'))
    score_files = get_score_files(request)
    ref_name = request.form['ref_name']

    aligned_scores = {}
    aligned_seqs = {}
    aligned_positions = {}
    max_scores = {}

    selected_threshold, ranks_threshold = get_thresholds(request)
    should_show_binding_sites = selected_threshold is not None or ranks_threshold is not None
    should_show_diff_only = should_show_binding_sites and request.form['show_diff_only'] == 'true'
    if should_show_binding_sites:
        highest_values, binding_sites, gaps, insertions = {}, {}, {}, {}

    for score_file in score_files:
        score_path = os.path.join(app.config['ESCORE_FOLDER'], score_file)

        name, motif, table = get_score_table(score_path, file_type)
        scores_dict = table.score_seqs(sequences)

        max_scores[score_file] = table.max_score()
        aligned_scores[score_file] = curr_aligned_scores = {}
        ref_seq, ref_scores = scores_dict[ref_name]

        for name, (sequence_str, sequence_scores) in scores_dict.items():
            aligned_seqs[name], aligned_positions[name], curr_aligned_scores[name] = align_scores(ref_seq, sequence_str, sequence_scores)

        if should_show_binding_sites:
            highest_values[score_file], binding_sites[score_file], gaps[score_file], insertions[score_file] = find_highest_values_and_binding_sites(
                aligned_scores[score_file], aligned_positions, sequences, ref_name, selected_threshold, ranks_threshold, table)

    if should_show_diff_only:
        show_diff_only(binding_sites, ref_name)

    plot_data = {
        'ref_name': ref_name,
        'sequence_strs': sequences,
        'aligned_seqs': aligned_seqs,
        'aligned_scores': aligned_scores,
        'aligned_positions': aligned_positions,
        'max_scores': max_scores,
    }
    if should_show_binding_sites:
        plot_data.update({
            'highest_values': highest_values,
            'binding_sites': binding_sites,
            'gaps': gaps,
            'insertions': insertions
        })

    return jsonify(plot_data)


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


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=80, debug=True)
