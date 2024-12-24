import os
import tqdm
import itertools
import numpy as np
import pandas as pd

import consts
import bindline

# write all escore file paths to a list
escore_files = []
for root, dirs, files in os.walk(consts.ESCORE_DIR):
    for file in files:
        if file.endswith(".txt"):
            escore_files.append(os.path.join(root.replace(consts.ESCORE_DIR, '').strip('/\\'), file))
# write to a file
with open(consts.ESCORE_FILE_LIST, 'w') as f:
    for file in escore_files:
        f.write(file + '\n')

# for each file, read the escore matrix and make a matrix of the scores
cols_order = [''.join(i) for i in itertools.product('ACGT', repeat=8)]
mat = np.full((len(escore_files), len(cols_order)), np.nan)
zscore_mat = np.full((len(escore_files), len(cols_order)), np.nan)
iscore_mat = np.full((len(escore_files), len(cols_order)), np.nan)
ranks_mat = np.full((len(escore_files), len(cols_order)), np.nan)

# for each file
for file in tqdm.tqdm(open(consts.ESCORE_FILE_LIST, 'r').readlines()):
    file = file.strip()
    escore_file = bindline.UniProbeEScoreFile(open(os.path.join(consts.ESCORE_DIR, file.strip())).read())
    zscore_file = bindline.UniProbeZScoreFile(open(os.path.join(consts.ESCORE_DIR, file.strip())).read())
    iscore_file = bindline.UniProbeIScoreFile(open(os.path.join(consts.ESCORE_DIR, file.strip())).read())
    _, _, escore_table = next(escore_file.parse_tables())
    try: _, _, zscore_table = next(zscore_file.parse_tables())
    except: zscore_table = None
    try: _, _, iscore_table = next(iscore_file.parse_tables())
    except: iscore_table = None
    if len(escore_table._dict) != len(cols_order):
        print(file, len(escore_table._dict))
    else:
        # order the scores according to the cols_order
        mat[escore_files.index(file)] = np.array([escore_table._dict[mer] for mer in cols_order])
        if zscore_table is not None:
            zscore_mat[escore_files.index(file)] = np.array([zscore_table._dict[mer] for mer in cols_order])
        if iscore_table is not None:
            iscore_mat[escore_files.index(file)] = np.array([iscore_table._dict[mer] for mer in cols_order])
        ranks_mat[escore_files.index(file)] = np.argsort(np.argsort(mat[escore_files.index(file)]))

# save the matrix
df = pd.DataFrame(mat, index=escore_files)
zscore_df = pd.DataFrame(zscore_mat, index=escore_files)
iscore_df = pd.DataFrame(iscore_mat, index=escore_files)
ranks_df = pd.DataFrame(ranks_mat, index=escore_files)

# set column names
df.columns = cols_order
zscore_df.columns = cols_order
iscore_df.columns = cols_order
ranks_df.columns = cols_order

df.to_pickle(consts.ESCORE_MATRIX_PKL)
zscore_df.to_pickle(consts.ZSCORE_MATRIX_PKL)
iscore_df.to_pickle(consts.ISCORE_MATRIX_PKL)
ranks_df.to_pickle(consts.ESCORE_RANK_MATRIX_PKL)
