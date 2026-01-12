import json
import os
import time
import uuid
import zipfile

import pandas as pd

from app import consts
from app.bindline_utils import BindingSiteParams


def return_error_on_exception(func):
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except:
            return 'ERROR'
    return wrapper


@return_error_on_exception
def export_bindline_csv(plot_data):
    if 'aligned_scores' not in plot_data:
        return
    # columns: sequence_name, sequence, aligned_sequence, score_file, pos1, pos2, ..., posN
    all_positions = sorted(set(pos for positions in plot_data['aligned_positions'].values() for pos in positions))
    df = pd.DataFrame(columns=['sequence_name', 'sequence', 'aligned_sequence', 'score_file'] + all_positions)
    for score_file, scores in plot_data['aligned_scores'].items():
        for seq_name, sequence in plot_data['sequence_strs'].items():
            if seq_name not in scores:  # if deleted because not important
                continue
            # add new empty row
            df.loc[len(df)] = [None] * len(df.columns)
            pos = list(plot_data['aligned_positions'][seq_name])[:len(scores[seq_name])]
            df.loc[len(df) - 1][['sequence_name', 'sequence', 'aligned_sequence', 'score_file'] + pos] =\
                [seq_name, sequence, plot_data['aligned_seqs'][seq_name], score_file] + scores[seq_name]
    # remove empty columns
    df = df.dropna(axis=1, how='all')
    # to csv text
    return df.to_csv()


@return_error_on_exception
def export_binding_sites_csv(plot_data):
    if 'binding_sites' not in plot_data:
        return
    # columns: sequence_name, sequence, aligned_sequence, score_file, aligned_start, aligned_end, bs_sequence, bs_start, bs_end
    df = pd.DataFrame(columns=['sequence_name', 'sequence', 'aligned_sequence', 'score_file', 'aligned_start', 'aligned_end', 'bs_sequence', 'bs_start', 'bs_end'])
    for score_file, binding_sites in plot_data['binding_sites'].items():
        for seq_name, sequence in plot_data['sequence_strs'].items():
            if seq_name not in binding_sites:  # if deleted because not important
                continue
            for bs in binding_sites[seq_name]:
                df.loc[len(df)] = [seq_name, sequence, plot_data['aligned_seqs'][seq_name], score_file,
                                   bs[BindingSiteParams.START], bs[BindingSiteParams.END], bs[BindingSiteParams.SEQ],
                                   bs[BindingSiteParams.BS_START], bs[BindingSiteParams.BS_END]]
    return df.to_csv()


@return_error_on_exception
def export_all_mutants_csv(plot_data):
    if 'mutants_effect' not in plot_data:
        return
    # columns: sequence_name, sequence, aligned_sequence, score_file, aligned_position, score
    df = pd.DataFrame(columns=['sequence_name', 'sequence', 'aligned_sequence', 'score_file', 'position', 'base', 'score'])
    ref_name = plot_data['ref_name']
    ref_seq = plot_data['sequence_strs'][ref_name]
    for score_file, scores in plot_data['mutants_effect'].items():
        for pos, pos_scores in enumerate(scores):
            for base, score in pos_scores.items():
                df.loc[len(df)] = [ref_name, ref_seq, plot_data['aligned_seqs'][ref_name], score_file, pos, base, score]
    return df.to_csv()


@return_error_on_exception
def export_general_data_csv(plot_data):
    # columns: name, value
    df = pd.DataFrame(columns=['name', 'value'])
    df.loc[len(df)] = ['ref_name', plot_data['ref_name']]
    return df.to_csv()


def export_json(plot_data):
    return json.dumps(plot_data)


def export_data_inner(plot_data, request_data):
    bindline_csv = export_bindline_csv(plot_data)
    binding_sites_csv = export_binding_sites_csv(plot_data)
    all_mutants_csv = export_all_mutants_csv(plot_data)
    general_data_csv = export_general_data_csv(plot_data)
    query_data = export_json(request_data)
    json_data = export_json(plot_data)
    # create zip in the results folder, with generated name containing the date and time and a random guid
    dir_name = time.strftime('%Y-%m-%d_%H-%M-%S')
    file_name = f'{uuid.uuid4()}.zip'
    os.makedirs(os.path.join(consts.RESULTS_DIR, dir_name), exist_ok=True)
    with zipfile.ZipFile(os.path.join(consts.RESULTS_DIR, dir_name, file_name), 'w') as zipf:
        if bindline_csv:
            zipf.writestr('bindline.csv', bindline_csv)
        if binding_sites_csv:
            zipf.writestr('binding_sites.csv', binding_sites_csv)
        if all_mutants_csv:
            zipf.writestr('all_mutants.csv', all_mutants_csv)
        zipf.writestr('general_data.csv', general_data_csv)
        zipf.writestr('query.json', query_data)
        zipf.writestr('data.json', json_data)
    return f'/results/{dir_name}/{file_name}'


def export_data(plot_data, request_data=None):
    try:
        return export_data_inner(plot_data, request_data)
    except Exception as e:
        print(f'Error exporting data: {e}')
