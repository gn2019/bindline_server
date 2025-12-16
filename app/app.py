import itertools
import os.path

from flask import Flask, render_template, request, jsonify, Response, send_from_directory, redirect, url_for, send_file
from flask_cors import CORS
from flask_login import LoginManager, login_required, current_user, user_logged_out
import traceback
import zipfile
import ssl
import json
import io

from . import auth
from . import bindline
from . import consts
from . import files
from .database_setup import db, User
from .auth import auth_bp  # Import the authentication blueprint
from .files import files_bp  # Import the files blueprint
from .bindline_utils import *
from .tfidentifier import TFIdentifier


app = Flask(__name__)
CORS(app)
app.config['UPLOAD_FOLDER'] = consts.UPLOAD_DIR
app.config['FASTA_FOLDER'] = consts.FASTA_DIR
app.config['SCORE_FOLDER'] = consts.SCORE_DIR
app.config['SQLALCHEMY_DATABASE_URI'] = f"sqlite:///{os.path.abspath(os.path.join(os.path.dirname(__file__), 'instance', 'database.db'))}"
app.config['SECRET_KEY'] = 'GAIAEJKC@#QJTKKZ MEK J$KJFSZ WEFSFWAfewa'

context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
with open("config.json") as f:
    cfg = json.load(f)
context.load_cert_chain(cfg["ssl_cert"], cfg["ssl_key"])

db.init_app(app)
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'auth.login'


@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))


app.register_blueprint(auth_bp, url_prefix='/auth')
app.register_blueprint(files_bp, url_prefix='/files')

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['FASTA_FOLDER'], exist_ok=True)
os.makedirs(app.config['SCORE_FOLDER'], exist_ok=True)

public_identifiers = {
    consts.ESCORE: TFIdentifier(consts.PUBLIC_ESCORE_DIR, consts.PUBLIC_RANKS_DIR),
    consts.ZSCORE: TFIdentifier(consts.PUBLIC_ZSCORE_DIR, consts.PUBLIC_RANKS_DIR),
    consts.ISCORE: TFIdentifier(consts.PUBLIC_ISCORE_DIR, consts.PUBLIC_RANKS_DIR),
}

# Per-user, in-memory TFIdentifier cache
identifiers_cache = {}  # { user_id: { score_type: TFIdentifier } }


def error_wrapped(func):
    def inner(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            traceback.print_exc()
            return jsonify({'error': str(e)}), 500
    return inner


@user_logged_out.connect_via(app)
def clear_identifiers_on_logout(sender, user):
    user_id = user.id
    identifiers_cache.pop(user_id, None)


@login_required
@app.route('/dashboard')
def dashboard():
    return render_template("dashboard.html",
                           is_authenticated=current_user.is_authenticated,
                           fasta_files=files.list_user_fasta_files(),
                           score_files=files.list_user_score_files())


def update_mats(file):
    if file.file_type != files.FileType.SCORE or file.is_public or not current_user.is_authenticated:
        return

    user_dict = load_user_identifiers()
    file_path = get_file_path(file)
    file_content = open(file_path).read()
    for score_type, tbl in {
        consts.ESCORE: bindline.UniProbeEScoreFile(file_content),
        consts.ZSCORE: bindline.UniProbeZScoreFile(file_content),
        consts.ISCORE: bindline.UniProbeIScoreFile(file_content)
    }.items():
        try:
            _, _, table = next(tbl.parse_tables())
            if score_type in user_dict:
                user_dict[score_type].update(file.id, table, should_update_ranks=(score_type == consts.ESCORE), should_save=True)
            else:
                user_mat_path = get_user_matrix_path(score_type)
                user_ranks_path = get_user_matrix_path(score_type, ranks=True)
                new_identifier = TFIdentifier(user_mat_path, user_ranks_path)
                new_identifier.update(file.id, table, should_update_ranks=(score_type == consts.ESCORE), should_save=True)
                user_dict[score_type] = new_identifier
        except Exception as e:
            traceback.print_exc()
            print(f"Error parsing {score_type} table for file {file.filename}: {e}")

    load_user_identifiers(force=True)


@app.route("/download/sample-score")
def download_sample_score():
    return send_from_directory(os.path.join(app.root_path, 'static', 'samples'), 'score.tsv')


@app.route("/download/sample-fasta")
def download_sample_fasta():
    return send_from_directory(os.path.join(app.root_path, 'static', 'samples'), 'sequences.fasta')


def delete_from_mats(file):
    if file.file_type != files.FileType.SCORE or file.is_public or not current_user.is_authenticated:
        return

    user_dict = load_user_identifiers()
    for score_type in consts.SCORES:
        if score_type in user_dict:
            user_dict[score_type].remove(file.id, should_update_ranks=(score_type == consts.ESCORE), should_save=True)


def upload_and_update_db(file, file_type):
    file_metadata = files.upload_metadata(file.filename, file_type, is_public=False)
    if file_metadata:
        file_path = get_file_path(file_metadata)
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        file.save(file_path)
        update_mats(file_metadata)
        return file_metadata


def get_score_files(request):
    if 'score' in request.files and request.files.getlist('score')[0].filename:
        # save them (it's a list of files)
        if current_user.is_authenticated:
            score_files = request.files.getlist('score')
            stored_files = []
            for score_file in score_files:
                file = upload_and_update_db(score_file, files.FileType.SCORE)
                if not file:
                    return jsonify({'error': f'Failed to upload score file {score_file.filename}.'}), 500
                stored_files.append(file)
            # take their names
            return [(file.filename, get_file_path(file)) for file in stored_files]
        else:
            return [(score_file.filename, io.StringIO(score_file.read().decode("utf-8")))
                    for score_file in request.files.getlist('score')]
    else:
        score_files = []
        for var in request.form:
            if var.startswith('score_'):
                file_id = int(request.form[var])
                file = files.get_file_by_id(file_id)
                score_files.append((file.filename, get_file_path(file)),)
        return score_files


def load_user_identifiers(force=False):
    if not current_user.is_authenticated:
        return {}

    user_id = current_user.id
    # If we already loaded for this user and no force reload → return cached
    if user_id in identifiers_cache and not force:
        return identifiers_cache[user_id]

    # Build fresh dict for this user
    user_dict = {}
    for name in consts.SCORES:
        path = get_user_matrix_path_if_exists(name)
        ranks_path = get_user_matrix_path_if_exists(name, ranks=True)
        if path:
            user_dict[name] = TFIdentifier(path, ranks_path)

    identifiers_cache[user_id] = user_dict
    return user_dict


def get_identifier_by_type(file_type):
    if file_type not in public_identifiers:
        raise ValueError("Invalid file type selected.")
    identifier = public_identifiers[file_type]
    if current_user.is_authenticated:
        user_dict = load_user_identifiers()
        if file_type in user_dict:
            identifier += user_dict[file_type]
    return identifier


@app.route('/list-files/<file_type>', methods=['GET'])
def list_files(*args, **kwargs):
    return error_wrapped(list_files_)(*args, **kwargs)

def list_files_(file_type):
    """Lists public and user-specific files for FASTA or E-Score files."""
    username = current_user.username if current_user.is_authenticated else None
    if file_type == consts.FASTA:
        return jsonify(list_user_public_fasta_file_names(username))
    elif file_type == consts.SCORE:
        return jsonify(list_user_public_score_file_jsons())
    else:
        return jsonify({"error": "Invalid file type"}), 400


@app.route('/', methods=['GET'])
def index():
    sample_id = request.args.get('sample_id')
    return render_template('index.html', is_authenticated=current_user.is_authenticated, sample_id=sample_id)


def get_file_folder(file):
    if file.file_type == files.FileType.FASTA:
        return app.config['FASTA_FOLDER']
    if file.file_type == files.FileType.SCORE:
        return app.config['SCORE_FOLDER']
    raise ValueError("Invalid file type")


def get_file_user_uuid(file):
    return consts.PUBLIC_DIR if file.is_public else auth.get_current_user_uuid()


def get_file_path(file):
    return os.path.join(get_file_folder(file), get_file_user_uuid(file), file.uuid)


@app.route('/sequences', methods=['POST'])
def get_sequences(*args, **kwargs):
    return error_wrapped(get_sequences_)(*args, **kwargs)

def get_sequences_():
    fasta_file = request.files.get('fasta')  # Get uploaded file, if any
    existing_fasta = request.form.get('existing_fasta')  # Get existing file if selected

    # Determine the FASTA file to use
    if fasta_file:
        if current_user.is_authenticated:
            file = upload_and_update_db(fasta_file, files.FileType.FASTA)
            if file:
                fasta_path = get_file_path(file)
            else:
                return jsonify({'error': 'Failed to upload FASTA file.'}), 500
        else:
            # pass as a stream without saving
            fasta_path = io.StringIO(fasta_file.read().decode("utf-8"))
    elif existing_fasta:
        file = files.get_file_by_name(existing_fasta, files.FileType.FASTA)
        if not file:
            return jsonify({'error': 'FASTA file not found.'}), 404
        fasta_path = get_file_path(file)
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


def get_sequences_from_request(request):
    sequences = json.loads(request.form.get('sequences'))
    return {name: seq.upper() for name, seq in sequences.items()}


def find_binding_sites():
    file_type = request.form.get('file_type')
    sequences = get_sequences_from_request(request)
    selected_threshold, ranks_threshold = get_thresholds(request)
    ref_name = request.form.get('ref_name')
    # identify by both identifiers, and combine
    identifier = get_identifier_by_type(file_type)
    identified_TFs = identifier(sequences, absolute_threshold=selected_threshold, rank_threshold=ranks_threshold, summarize=True)
    identified_unq_file_ids = set(map(int, sum(sum(map(lambda x: x[1], identified_TFs.values()), []), [])))

    # Get the tables for each identified file
    identified_tables = {}
    identified_binding_sites = {}
    for file_id in identified_unq_file_ids:
        file = files.get_file_by_id(file_id)
        _, _, identified_tables[file.filename] = get_score_table(get_file_path(file), file_type)
        score = identified_tables[file.filename].score_seqs(sequences)

        identified_binding_sites[file.filename] = {}
        for seq_name in identified_TFs:
            curr_bs = [score[seq_name][1][i] if file_id in pos_ls else None
                       for i, pos_ls in enumerate(identified_TFs[seq_name][1])]
            _, _, identified_binding_sites[file.filename][seq_name] = align_scores(sequences[ref_name], sequences[seq_name], curr_bs)

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

    if request.form.get('show_diff_only') == 'true':
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

    print(plot_data)  # TODO: remove

    return Response(
        json.dumps(plot_data, allow_nan=False),
        mimetype='application/json'
    )


def find_significant_mutations():
    file_type = request.form.get('file_type')
    sequences = get_sequences_from_request(request)
    assert len(sequences) == 1, "Only one sequences are allowed for this analysis."  # checked in js
    selected_threshold, ranks_threshold = get_thresholds(request)
    assert selected_threshold is not None or ranks_threshold is not None, \
        "Either score or rank threshold must be provided."   # checked in js

    ref_name = request.form.get('ref_name')
    sequences = get_all_mutants(*next(iter(sequences.items())))
    score_files = get_score_files(request)

    aligned_scores = {}
    aligned_seqs = {}
    aligned_positions = {}
    highest_values = {}
    max_scores = {}
    binding_sites = {}
    gaps, insertions = {}, {}

    for score_file, score_path in score_files:
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
def upload_files(*args, **kwargs):
    return error_wrapped(upload_files_)(*args, **kwargs)

def upload_files_():
    if request.form.get('search_binding_sites') == 'true':
        return find_binding_sites()
    if request.form.get('search_significant_mutations') == 'true':
        return find_significant_mutations()

    file_type = request.form.get('file_type')
    sequences = get_sequences_from_request(request)
    score_files = get_score_files(request)
    ref_name = request.form.get('ref_name')

    aligned_scores = {}
    aligned_seqs = {}
    aligned_positions = {}
    max_scores = {}

    selected_threshold, ranks_threshold = get_thresholds(request)
    should_show_binding_sites = selected_threshold is not None or ranks_threshold is not None
    should_show_diff_only = should_show_binding_sites and request.form.get('show_diff_only') == 'true'
    if should_show_binding_sites:
        highest_values, binding_sites, gaps, insertions = {}, {}, {}, {}

    for score_file, score_path in score_files:
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


@app.route('/delete_file/<file_id>', methods=['POST'])
@login_required
def delete_file(*args, **kwargs):
    return error_wrapped(delete_file_)(*args, **kwargs)

def delete_file_(file_id):
    file_metadata = files.get_file_by_id(file_id)
    # delete from db
    files.delete_file(file_metadata.uuid)
    # delete from disk
    file_path = get_file_path(file_metadata)
    if os.path.exists(file_path):
        os.remove(file_path)
        delete_from_mats(file_metadata)
        return jsonify({'message': 'File deleted successfully'})
    else:
        return jsonify({'error': 'File not found'}), 404


def get_download_name(filename):
    if '.' not in os.path.basename(filename):
        return filename + '.txt'
    return filename


def get_archive_name(file):
    if file.dataset and file.publication:
        return os.path.join(file.dataset, file.publication, get_download_name(file.filename))
    if file.dataset:
        return os.path.join(file.dataset, get_download_name(file.filename))
    if file.publication:
        return os.path.join(file.publication, get_download_name(file.filename))
    return get_download_name(file.filename)


@app.route('/download-public/<file_id>')
def download_public_file(*args, **kwargs):
    return error_wrapped(download_public_file_)(*args, **kwargs)

def download_public_file_(file_id):
    file = files.get_file_by_id(file_id)
    file_path = get_file_path(file)
    if os.path.exists(file_path):
        file_path = os.path.abspath(file_path)
        # avoid downloading if not in uploads
        if not file_path.startswith(os.path.abspath(consts.UPLOAD_DIR)):
            return jsonify({'error': 'File not found'}), 404
        return send_from_directory(os.path.dirname(file_path), os.path.basename(file_path),
                                   as_attachment=True, download_name=get_download_name(file.filename))
    else:
        return jsonify({'error': 'File not found'}), 404


@app.route('/download/<file_id>')
@login_required
def download_file(*args, **kwargs):
    return error_wrapped(download_file_)(*args, **kwargs)

def download_file_(file_id):
    return download_public_file_(file_id)


# def get_file_path(file_type, f, is_public=False):
#     if file_type == consts.FASTA:
#         return os.path.join(app.config['FASTA_FOLDER'], consts.PUBLIC_DIR if is_public else current_user.username, f)
#     elif file_type == consts.SCORE:
#         return os.path.join(app.config['SCORE_FOLDER'], consts.PUBLIC_DIR if is_public else current_user.username, f)
#     else:
#         raise ValueError("Invalid file type")


@app.post("/bulk")
def bulk_action(*args, **kwargs):
    return error_wrapped(bulk_action_)(*args, **kwargs)

def bulk_action_():
    request_files = request.form.getlist("files")
    action = request.form.get("action")

    if action == "delete":
        for f in request_files:
            delete_file(f)
        return redirect(url_for("dashboard"))

    if action == "download":
        # create a zip
        mem = io.BytesIO()
        with zipfile.ZipFile(mem, "w") as z:
            for f in request_files:
                file = files.get_file_by_id(f)
                path = get_file_path(file)
                z.write(path, arcname=get_archive_name(file))
        mem.seek(0)
        return send_file(mem, as_attachment=True, download_name="files.zip")


@app.route("/help")
def help_page():
    return render_template("help.html", is_authenticated=current_user.is_authenticated)


@app.route("/data")
def data_page():
    return render_template("data.html",
        is_authenticated=current_user.is_authenticated,
        fasta_files=files.list_public_fasta_files(),
        score_files=files.list_public_score_files()
    )


@app.route('/favicon.ico')
def favicon():
    return send_from_directory(os.path.join(app.root_path, 'static', 'icons'),
                               'favicon.ico', mimetype='image/vnd.microsoft.icon')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=443, debug=True, ssl_context=context)
