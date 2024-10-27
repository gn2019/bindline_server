import json

from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
import os
import sys
import numpy as np

import bindline

app = Flask(__name__)
CORS(app)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['FASTA_FOLDER'] = os.path.join(app.config['UPLOAD_FOLDER'], 'fasta')
app.config['ESCORE_FOLDER'] = os.path.join(app.config['UPLOAD_FOLDER'], 'escore')

if not os.path.exists(app.config['UPLOAD_FOLDER']):
    os.makedirs(app.config['UPLOAD_FOLDER'])
if not os.path.exists(app.config['FASTA_FOLDER']):
    os.makedirs(app.config['FASTA_FOLDER'])
if not os.path.exists(app.config['ESCORE_FOLDER']):
    os.makedirs(app.config['ESCORE_FOLDER'])


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


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/existing_fasta_files', methods=['GET'])
def existing_fasta_files():
    fasta_files = [f for f in os.listdir(app.config['FASTA_FOLDER'])]
    return jsonify({'files': fasta_files})


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



@app.route('/upload', methods=['POST'])
def upload_files():
    print('HERE WE ARE IN UPLOAD PYTHON')
    print(request.files, request.form)

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
    max_scores = {}

    for e_score_file in e_score_files:
        e_score_path = os.path.join(app.config['ESCORE_FOLDER'], e_score_file)

        with open(e_score_path, 'r') as f:
            if file_type == 'escore':
                score = bindline.UniProbeEScoreFile(f.read())
            elif file_type == 'zscore':
                score = bindline.UniProbeZScoreFile(f.read())
            elif file_type == 'iscore':
                score = bindline.UniProbeIScoreFile(f.read())
            else:
                raise ValueError("Invalid file type selected.")

        name, motif, table = next(score.parse_tables())
        scores_dict = table.score_seqs(sequences)
        max_scores[e_score_file] = max(table._dict.values())
        curr_aligned_scores = {}

        if not curr_aligned_scores:
            ref_name = max(scores_dict, key=lambda k: len(scores_dict[k][1]))
            ref_scores = scores_dict[ref_name][1]

        for name, (sequence_str, sequence_scores) in scores_dict.items():
            curr_aligned_scores[name] = align_sequences(ref_scores, sequence_scores)

        aligned_scores[e_score_file] = curr_aligned_scores

    plot_data = {
        'aligned_scores': aligned_scores,
        'sequence_names': list(scores_dict.keys()),
        'sequence_str': scores_dict[ref_name][0],
        'max_scores': max_scores
    }

    print(plot_data)

    return jsonify(plot_data)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=80, debug=True)
