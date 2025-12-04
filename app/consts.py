import os.path


UPLOAD_DIR = os.path.join('data', 'uploads')
PUBLIC_DIR = 'public'
UPDATES_DIR = os.path.join(UPLOAD_DIR, 'updates')
FASTA = 'fasta'
SCORE = 'score'
FASTA_DIR = os.path.join(UPLOAD_DIR, FASTA)
SCORE_DIR = os.path.join(UPLOAD_DIR, SCORE)

SCORE_FILE_LIST = os.path.join(UPLOAD_DIR, 'score_file_list.txt')

ESCORE = 'escore'
ZSCORE = 'zscore'
ISCORE = 'iscore'
SCORES = (ESCORE, ZSCORE, ISCORE)
ESCORE_RANKS = 'escore_ranks'

ESCORE_MATRIX = f'{ESCORE}_matrix.pkl'
ZSCORE_MATRIX = f'{ZSCORE}_matrix.pkl'
ISCORE_MATRIX = f'{ISCORE}_matrix.pkl'
ESCORE_RANK_MATRIX = f'{ESCORE_RANKS}_matrix.pkl'

PUBLIC_ESCORE_MATRIX = os.path.join(SCORE_DIR, PUBLIC_DIR, ESCORE_MATRIX)
PUBLIC_ZSCORE_MATRIX = os.path.join(SCORE_DIR, PUBLIC_DIR, ZSCORE_MATRIX)
PUBLIC_ISCORE_MATRIX = os.path.join(SCORE_DIR, PUBLIC_DIR, ISCORE_MATRIX)
PUBLIC_ESCORE_RANK_MATRIX = os.path.join(SCORE_DIR, PUBLIC_DIR, ESCORE_RANK_MATRIX)

DNA_BASES = ['A', 'C', 'G', 'T']