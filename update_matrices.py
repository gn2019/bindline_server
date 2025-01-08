import pickle 
import tqdm
import numpy as np
import consts
import bindline
from os import listdir
from os.path import join
import argparse

parser = argparse.ArgumentParser()
parser.add_argument("VERSION", help="Upade version directory")
args = vars(parser.parse_args())
VERSION = args['VERSION']

print(f'Upading data matrices by version {VERSION}')

# Load the four saved matrices
df_ls = []
for path in [consts.ESCORE_MATRIX_PKL, consts.ZSCORE_MATRIX_PKL, consts.ISCORE_MATRIX_PKL, consts.ESCORE_RANK_MATRIX_PKL]:
    with open(path, 'rb') as file:
        df_ls.append(pickle.load(file))
escore_df, zscore_df, iscore_df, ranks_df = df_ls
cols_order = escore_df.columns

# Read the list file of all files included in the data
with open(consts.ESCORE_FILE_LIST, 'r') as file:
    file_ls = np.array(file.read().split('\n')).astype(str)

# Remove empty values
file_ls = list(file_ls[np.char.str_len(file_ls) > 0])


# For each file in the updates of the specific version
for file in tqdm.tqdm(listdir(join(consts.UPDATES_DIR, VERSION))):

    file_path = join(consts.UPDATES_DIR, VERSION, file)

    # Get all of the tables
    escore_file = bindline.UniProbeEScoreFile(open(file_path).read())
    zscore_file = bindline.UniProbeZScoreFile(open(file_path).read())
    iscore_file = bindline.UniProbeIScoreFile(open(file_path).read())
    _, _, escore_table = next(escore_file.parse_tables())
    try: _, _, zscore_table = next(zscore_file.parse_tables())
    except: zscore_table = None
    try: _, _, iscore_table = next(iscore_file.parse_tables())
    except: iscore_table = None
    if len(escore_table._dict) != len(cols_order):
        print(file, len(escore_table._dict))
    else:

        # For each score df append the values to the previous data frames
        for df, table in zip([escore_df, zscore_df, iscore_df], [escore_table, zscore_table, iscore_table]):
            if table is not None:
                df.loc[file_path] = np.array([table._dict[mer] for mer in cols_order])

        # Add the ranks values
        ranks_df.loc[file_path] = np.argsort(np.argsort(escore_df.loc[file_path]))

        # Add to the file list the current file
        file_ls.append(file_path)

escore_df.to_pickle(consts.ESCORE_MATRIX_PKL)
zscore_df.to_pickle(consts.ZSCORE_MATRIX_PKL)
iscore_df.to_pickle(consts.ISCORE_MATRIX_PKL)
ranks_df.to_pickle(consts.ESCORE_RANK_MATRIX_PKL)

with open(consts.ESCORE_FILE_LIST, 'w') as file:
    for file_path in file_ls:
        file.write(f'{file_path}\n')