import os.path


UPLOAD_DIR = os.path.join('data', 'uploads')
PUBLIC_DIR = 'public'
IDENTIFIERS_DIR = 'identifiers'
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

PUBLIC_ESCORE_DIR = os.path.join(SCORE_DIR, PUBLIC_DIR, IDENTIFIERS_DIR, ESCORE)
PUBLIC_ZSCORE_DIR = os.path.join(SCORE_DIR, PUBLIC_DIR, IDENTIFIERS_DIR, ZSCORE)
PUBLIC_ISCORE_DIR = os.path.join(SCORE_DIR, PUBLIC_DIR, IDENTIFIERS_DIR, ISCORE)
PUBLIC_RANKS_DIR = os.path.join(SCORE_DIR, PUBLIC_DIR, IDENTIFIERS_DIR, ESCORE_RANKS)

DNA_BASES = ['A', 'C', 'G', 'T']
