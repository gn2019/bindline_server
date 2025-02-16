import os.path


UPLOAD_DIR = 'uploads'
UPDATES_DIR = os.path.join(UPLOAD_DIR, 'updates')
FASTA_DIR = os.path.join(UPLOAD_DIR, 'fasta')
ESCORE_DIR = os.path.join(UPLOAD_DIR, 'escore')
ESCORE_FILE_LIST = os.path.join(UPLOAD_DIR, 'score_file_list.txt')
ESCORE_MATRIX_PKL = os.path.join(UPLOAD_DIR, 'escore_matrix.pkl')
ZSCORE_MATRIX_PKL = os.path.join(UPLOAD_DIR, 'zscore_matrix.pkl')
ISCORE_MATRIX_PKL = os.path.join(UPLOAD_DIR, 'iscore_matrix.pkl')
ESCORE_RANK_MATRIX_PKL = os.path.join(UPLOAD_DIR, 'escore_rank_matrix.pkl')

DNA_BASES = ['A', 'C', 'G', 'T']