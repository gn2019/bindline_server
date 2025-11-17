
from flask import Flask, render_template, request, jsonify, Response, send_from_directory
from flask_cors import CORS
from flask_login import LoginManager, login_required, current_user
import ssl
import json
import os

import bindline
import consts
from database_setup import db, User
from auth import auth_bp  # Import the authentication blueprint
from bindline_utils import *


app = Flask(__name__)
CORS(app)
app.config['UPLOAD_FOLDER'] = consts.UPLOAD_DIR
app.config['FASTA_FOLDER'] = consts.FASTA_DIR
app.config['ESCORE_FOLDER'] = consts.ESCORE_DIR
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///database.db'
app.config['SECRET_KEY'] = 'GAIAEJKC@#QJTKKZ MEK J$KJFSZ WEFSFWAfewa'

context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain('cert.crt', 'priv.key')

db.init_app(app)
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'auth.login'


@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))


app.register_blueprint(auth_bp, url_prefix='/auth')

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['FASTA_FOLDER'], exist_ok=True)
os.makedirs(app.config['ESCORE_FOLDER'], exist_ok=True)

escore_identifier = bindline.TFIdentifier(absolute_hypo_file=consts.ESCORE_MATRIX_PKL,
                                          rank_hypo_file=consts.ESCORE_RANK_MATRIX_PKL)
zscore_identifier = bindline.TFIdentifier(absolute_hypo_file=consts.ZSCORE_MATRIX_PKL,
                                          rank_hypo_file=consts.ESCORE_RANK_MATRIX_PKL)
iscore_identifier = bindline.TFIdentifier(absolute_hypo_file=consts.ISCORE_MATRIX_PKL,
                                          rank_hypo_file=consts.ESCORE_RANK_MATRIX_PKL)


@login_required
@app.route('/dashboard')
def dashboard():
    return render_template("dashboard.html", username=current_user.username,
                           fasta_files=list_user_fasta_files(current_user.username, include_username=False),
                           score_files=list_user_score_files(current_user.username, include_username=False))


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


def get_identifier_by_type(file_type):
    if file_type == 'escore':
        return escore_identifier
    elif file_type == 'zscore':
        return zscore_identifier
    elif file_type == 'iscore':
        return iscore_identifier
    else:
        raise ValueError("Invalid file type selected.")


@app.route('/list-files/<filetype>', methods=['GET'])
def list_files(filetype):
    """Lists public and user-specific files for FASTA or E-Score files."""
    username = current_user.username if current_user.is_authenticated else None
    if filetype == 'fasta':
        return jsonify(sum(list_user_public_fasta_files(username), []))
    elif filetype == 'escore':
        return jsonify(sum(list_user_public_score_files(username), []))
    else:
        return jsonify({"error": "Invalid file type"}), 400


@app.route('/')
def index():
    return render_template('index.html', is_authenticated=current_user.is_authenticated)


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


@app.route('/delete_file/<file_type>/<file>', methods=['POST'])
@login_required
def delete_file(file_type, file):
    if file_type == 'fasta':
        file_path = os.path.join(app.config['FASTA_FOLDER'], current_user.username, file)
    elif file_type == 'score':
        file_path = os.path.join(app.config['ESCORE_FOLDER'], current_user.username, file)
    else:
        return jsonify({'error': 'Invalid file type'}), 400
    if os.path.exists(file_path):
        os.remove(file_path)
        return jsonify({'message': 'File deleted successfully'})
    else:
        return jsonify({'error': 'File not found'}), 404


@app.route('/download/<file_type>/<file>')
@login_required
def download_file(file_type, file):
    if file_type == 'fasta':
        file_path = os.path.join(app.config['FASTA_FOLDER'], current_user.username, file)
    elif file_type == 'score':
        file_path = os.path.join(app.config['ESCORE_FOLDER'], current_user.username, file)
    else:
        return jsonify({'error': 'Invalid file type'}), 400
    if os.path.exists(file_path):
        return send_from_directory(os.path.dirname(file_path), os.path.basename(file_path), as_attachment=True)
    else:
        return jsonify({'error': 'File not found'}), 404


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=443, debug=True, ssl_context=context)
