import json
import functools

from flask import Flask, render_template, request, jsonify, Response
from flask_cors import CORS
from Bio.Align import PairwiseAligner
import json
import os
import sys
import numpy as np

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


def align_sequences(ref_scores, scores):
    min_i = bindline.align_scores(ref_scores, scores)
    del_size = len(ref_scores) - len(scores)
    aligned_scores = list(scores[:min_i]) + [None] * del_size + list(scores[min_i:])
    return aligned_scores

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
    return alignments[0][1]


def align_scores(ref_seq, seq, scores):
    aligned_seq = align_sequences(ref_seq, seq)
    # return the scores with gaps in the same positions
    aligned_scores = []
    j = 0
    for i in range(len(scores) + len(ref_seq) - len(seq)):
        is_gap = aligned_seq[i] == '-'
        aligned_scores.append(None if is_gap or j >= len(scores) else scores[j])
        j += int(not is_gap)
    return aligned_seq, aligned_scores


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

def get_score_file(e_score_path, file_type):
    with open(e_score_path, 'r') as f:
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


@app.route('/find-binding-sites', methods=['GET'])
def find_binding_sites():
    file_type = request.form['file_type']
    sequences = json.loads(request.form.get('sequences'))
    score_threshold = float_or_none(request.form.get('score_threshold'))
    ranks_threshold = float_or_none(request.form.get('ranks_threshold'))

    # identify by both identifiers, and combine
    identifier = get_identifier_by_type(file_type)
    identified_TFs = identifier(sequences, absolute_threshold=score_threshold, rank_threshold=ranks_threshold)

    ref_name = max(sequences, key=lambda k: len(sequences[k]))

    # Extract unique file paths of identified TFs
    identified_unq_files = []
    for seq_name in identified_TFs:

        # identified_TFs[seq_name] is a tuple where first value is the sequence
        # and the second is the list of lists of file paths
        pos_nested_ls = identified_TFs[seq_name][1]

        # For each list of path corresponding to a position
        for pos_ls in pos_nested_ls:
            identified_unq_files.extend(pos_ls)
    identified_unq_files = np.unique(identified_unq_files)

    # Get the tables for each identified file
    identified_tables = {}
    identified_binding_sites = {}
    for file in identified_unq_files:
        file_path = os.path.join(app.config['ESCORE_FOLDER'], file)
        _, _, identified_tables[file] = next(get_score_file(file_path, file_type).parse_tables())
        score = identified_tables[file].score_seqs(sequences)

        identified_binding_sites[file] = {}
        for seq_name in identified_TFs:
            curr_bs = [score[seq_name][1][i] if file in pos_ls else None
                       for i, pos_ls in enumerate(identified_TFs[seq_name][1])]
            _, identified_binding_sites[file][seq_name] = align_scores(sequences[ref_name], sequences[seq_name], curr_bs)

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
    binding_sites, gaps = {}, {}
    aligned_seqs = {}

    for e_score_file, table in identified_tables.items():
        scores_dict = table.score_seqs(sequences)
        max_scores[e_score_file] = table.max_score()
        curr_aligned_scores = {}
        ref_seq, ref_scores = scores_dict[ref_name]

        curr_binding_sites, curr_gaps = {}, {}
        for name, (sequence_str, sequence_scores) in scores_dict.items():
            # curr_aligned_scores[name] = align_sequences(ref_scores, sequence_scores)
            aligned_seqs[name], curr_aligned_scores[name] = align_scores(ref_seq, sequence_str, sequence_scores)
            curr_binding_sites[name], curr_gaps[name] = get_binding_sites(identified_binding_sites[e_score_file][name],
                                                                          aligned_seqs[name], table._mer)

        identified_scores[e_score_file] = curr_aligned_scores
        binding_sites[e_score_file], gaps[e_score_file] = curr_binding_sites, curr_gaps

    plot_data = {
        'aligned_scores': identified_scores,
        'highest_values': identified_binding_sites,
        'sequence_strs': sequences,
        'aligned_seqs': aligned_seqs,
        'ref_name': ref_name,
        'max_scores': max_scores,
        'binding_sites': binding_sites,
        'gaps': gaps
    }

    print(plot_data)

    return Response(
        json.dumps(plot_data, allow_nan=False),
        mimetype='application/json'
    )


@app.route('/upload', methods=['POST'])
def upload_files():
    if request.form['search_binding_sites'] == 'true':
        return find_binding_sites()

    if 'e_score' in request.files and request.files.getlist('e_score')[0].filename:
        # save them (it's a list of files)
        e_score_files = request.files.getlist('e_score')
        for e_score_file in e_score_files:
            e_score_path = os.path.join(app.config['ESCORE_FOLDER'], e_score_file.filename)
            e_score_file.save(e_score_path)
        # take their names
        e_score_files = [f.filename for f in e_score_files]
    else:
        e_score_files = [request.form[var] for var in request.form if var.startswith('e_score_')]

    file_type = request.form['file_type']
    sequences = json.loads(request.form.get('sequences'))

    aligned_scores = {}
    aligned_seqs = {}
    highest_values = {}
    max_scores = {}
    binding_sites = {}
    gaps = {}

    score_threshold = float_or_none(request.form.get('score_threshold'))
    ranks_threshold = float_or_none(request.form.get('ranks_threshold'))

    for e_score_file in e_score_files:
        e_score_path = os.path.join(app.config['ESCORE_FOLDER'], e_score_file)

        score = get_score_file(e_score_path, file_type)
        name, motif, table = next(score.parse_tables())
        scores_dict = table.score_seqs(sequences)

        max_scores[e_score_file] = table.max_score()
        curr_aligned_scores = {}
        ref_name = max(scores_dict, key=lambda k: len(scores_dict[k][1]))
        ref_seq, ref_scores = scores_dict[ref_name]

        for name, (sequence_str, sequence_scores) in scores_dict.items():
            aligned_seqs[name], curr_aligned_scores[name] = align_scores(ref_seq, sequence_str, sequence_scores)

        aligned_scores[e_score_file] = curr_aligned_scores

        curr_highest_values = {}
        for name, scores in aligned_scores[e_score_file].items():
            # highest scores are the ones above the absolute and relative thresholds, if exist
            if score_threshold is None and ranks_threshold is None:
                curr_highest_values[name] = [None for _ in scores]
            else:
                curr_highest_values[name] = [score if score is not None and
                                             (score_threshold is None or score >= score_threshold) and
                                             (ranks_threshold is None or score >= table.rank_threshold(ranks_threshold))
                                             else None for score in scores]
        highest_values[e_score_file] = curr_highest_values

        curr_binding_sites, curr_gaps = {}, {}
        for name, scores in aligned_scores[e_score_file].items():
            curr_binding_sites[name], curr_gaps[name] = get_binding_sites(
                curr_highest_values[name], align_sequences(ref_seq, sequences[name]), table._mer)
        binding_sites[e_score_file], gaps[e_score_file] = curr_binding_sites, curr_gaps

    plot_data = {
        'aligned_scores': aligned_scores,
        'highest_values': highest_values,
        'sequence_strs': sequences,
        'aligned_seqs': aligned_seqs,
        'ref_name': ref_name,
        'max_scores': max_scores,
        'binding_sites': binding_sites,
        'gaps': gaps
    }

    return jsonify(plot_data)


def get_binding_sites(highest_values, seq, mer):
    # indices of the not None values in curr_highest_values[name], by numpy
    bs = [i for i, value in enumerate(highest_values) if value is not None]
    # for each binding site, get the start and end indices
    # if there's a gap inside, calculate it
    # if there are multiple binding sites in a row, merge them
    curr_binding_sites = []
    curr_gaps = []
    for i in range(len(bs)):
        if i == 0 or bs[i] - bs[i - 1] > 1:
            start = bs[i]
        if i == len(bs) - 1 or bs[i + 1] - bs[i] > 1:
            end = bs[i]
            # count (table._mer - 1) non-gaps after the end
            remain = mer - 1
            for c in seq[end + 1:]:
                end += 1
                if c != '-':
                    remain -= 1
                    if remain == 0:
                        break
            curr_binding_sites.append((start, end, seq[start:end + 1]))
            # add to curr_gaps all the '-' indices inside (start, end) intervals
            curr_gaps += [i for i in range(start, end + 1) if seq[i] == '-']
    return curr_binding_sites, curr_gaps


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=80, debug=True)
