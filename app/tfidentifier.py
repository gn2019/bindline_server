import os
import glob

import numpy as np
from pathlib import Path


# -----------------------------------------------------
# Fast DNA encoding
# -----------------------------------------------------
_LUT = np.zeros(256, dtype=np.uint8)
_LUT[ord("A")] = 0
_LUT[ord("C")] = 1
_LUT[ord("G")] = 2
_LUT[ord("T")] = 3


def encode_sequence(seq: str):
    return _LUT[np.frombuffer(seq.encode("ascii"), dtype=np.uint8)]


def rolling_kmer_indices(enc, k):
    n = len(enc)
    windows = np.lib.stride_tricks.as_strided(
        enc,
        shape=(n - k + 1, k),
        strides=(enc.strides[0], enc.strides[0])
    )
    pows = (4 ** np.arange(k - 1, -1, -1)).astype(np.uint32)
    return (windows * pows).sum(axis=1)


class TFIdentifier:
    """
    Multi-mer vectoric TFIdentifier
    """
    def __init__(self, abs_folder: str = None, ranks_folder: str = None, other: 'TFIdentifier' = None):
        """
        in TFIdentifier folders there are files named as:
        abs_{k}.npy, rank_{k}.npy and abs_{k}_ids.npy, rank_{k}_ids.npy
        for absolute and rank matrices and their TF IDs
        """
        if other is not None:
            # Copy constructor
            self._abs_folder = other._abs_folder
            self._ranks_folder = other._ranks_folder
            self.abs_mat = {k: v.copy() for k, v in other.abs_mat.items()}
            self.abs_ids = {k: ids.copy() for k, ids in other.abs_ids.items()}
            self.rank_mat = {k: v.copy() for k, v in other.rank_mat.items()}
            self.rank_ids = {k: ids.copy() for k, ids in other.rank_ids.items()}
            self.kmers = other.kmers.copy()
            self._threshold_mat = {}
            return

        self._abs_folder = Path(abs_folder)
        self._ranks_folder = Path(ranks_folder)

        self.abs_mat = {}
        self.abs_ids = {}
        self.rank_mat = {}
        self.rank_ids = {}
        self.kmers = set()
        self._threshold_mat = {}

        self._load_matrices(
            abs_files={int(p.stem.split('_')[0]): p.name for p in self._abs_folder.glob("*_abs.npy")},
            abs_ids_files={int(p.stem.split('_')[0]): p.name for p in self._abs_folder.glob("*_abs_ids.npy")},
            rank_files={int(p.stem.split('_')[0]): p.name for p in self._ranks_folder.glob("*_rank.npy")},
            rank_ids_files={int(p.stem.split('_')[0]): p.name for p in self._ranks_folder.glob("*_rank_ids.npy")},
        )

    def _load_matrices(self, abs_files, abs_ids_files, rank_files, rank_ids_files):
        # Load absolute matrices
        for k, fname in abs_files.items():
            mat_path = self._abs_folder / fname
            ids_path = self._abs_folder / abs_ids_files[k]
            self.abs_mat[k] = np.load(mat_path)
            self.abs_ids[k] = np.load(ids_path)
            self.kmers.add(k)
        # Load rank matrices
        for k, fname in rank_files.items():
            mat_path = self._ranks_folder / fname
            ids_path = self._ranks_folder / rank_ids_files[k]
            self.rank_mat[k] = np.load(mat_path)
            self.rank_ids[k] = np.load(ids_path)
            self.kmers.add(k)

    def _prepare_thresholds(self, abs_thr, rank_thr):
        """
        Thresholding for ALL k-mer matrices
        :param abs_thr: a float value or None
        :param rank_thr:  a float value (percentage) or None
        :return: {k: thresholded_matrix, ...}
        """
        self._threshold_mat = {}

        for k in self.kmers:
            mat = None

            if abs_thr is not None and k in self.abs_mat:
                m = self.abs_mat[k]
                mat = np.where(m >= abs_thr, 1, np.nan)

            if rank_thr is not None and k in self.rank_mat:
                r = self.rank_mat[k]
                rank_ids = self.rank_ids[k]
                order = np.argsort(rank_ids)
                sorted_rank_ids = rank_ids[order]
                idx = np.searchsorted(sorted_rank_ids, self.abs_ids[k])
                r = r[order[idx]]
                local_rank_thr = rank_thr * np.nanmax(r) / 100

                if mat is None:
                    mat = np.where(r >= local_rank_thr, 1, np.nan)
                else:
                    mat = np.where(r >= local_rank_thr, mat, np.nan)

            self._threshold_mat[k] = mat

    def __identify_one(self, seq, summarize: bool = False):
        """
        Identify TFs for **one sequence**
        :param seq: sequence string
        :return: [(k, [[tf_ids_at_pos_0], [tf_ids_at_pos_1], ...]), ...]
        """
        enc = encode_sequence(seq)
        seq_hits = []
        for k in sorted(self.kmers):
            if len(seq) < k:
                continue
            idxs = rolling_kmer_indices(enc, k)
            mat = self._threshold_mat[k]  # TF × 4^k
            hits = ~np.isnan(mat[:, idxs])
            per_pos = [
                [self.abs_ids[k][j] for j in np.where(hits[:, i])[0]]
                for i in range(hits.shape[1])
            ]
            if summarize:
                # sum seq_hits with per_pos, is one is longer - extend
                if len(seq_hits) < len(per_pos):
                    seq_hits.extend([[] for _ in range(len(per_pos) - len(seq_hits))])
                for i in range(len(per_pos)):
                    seq_hits[i].extend(per_pos[i])
            else:
                seq_hits.append((k, per_pos))
        return seq_hits

    # Public API
    def __call__(self, seqs: dict, absolute_threshold=None, rank_threshold=None, summarize: bool = False):
        assert absolute_threshold is not None or rank_threshold is not None
        self._prepare_thresholds(absolute_threshold, rank_threshold)
        out = {}
        for name, seq in seqs.items():
            out[name] = (seq, self.__identify_one(seq, summarize=summarize))
        return out

    def update(self, tf_id: int, table: 'bindline.EScoreTable', should_update_ranks: bool = False, should_save: bool = True):
        """
        Update/add a TF ID with a new table
        """
        k = table.mer
        # remove tf_id from other k-mer matrices
        self.remove(tf_id, should_update_ranks, should_save)

        if k not in self.kmers:
            self.kmers.add(k)
            self.abs_mat[k] = np.empty((0, 4 ** k), dtype=np.float32)
            self.abs_ids[k] = np.empty((0,), dtype=np.int32)
            if should_update_ranks:
                self.rank_mat[k] = np.empty((0, 4 ** k), dtype=np.float32)
                self.rank_ids[k] = np.empty((0,), dtype=np.int32)

        # Update absolute matrix
        abs_vector = table.vectorize()
        self.abs_mat[k] = np.vstack([self.abs_mat.get(k, np.empty((0, abs_vector.shape[0]))), abs_vector])
        self.abs_ids[k] = np.append(self.abs_ids.get(k, []), tf_id)
        if should_save:
            os.makedirs(self._abs_folder, exist_ok=True)
            np.save(self._abs_folder / f"{k}_abs.npy", self.abs_mat[k])
            np.save(self._abs_folder / f"{k}_abs_ids.npy", self.abs_ids[k])
        # Update rank matrix
        if should_update_ranks:
            rank_vector = np.argsort(np.argsort(abs_vector))
            self.rank_mat[k] = np.vstack([self.rank_mat.get(k, np.empty((0, rank_vector.shape[0]))), rank_vector])
            self.rank_ids[k] = np.append(self.rank_ids.get(k, []), tf_id)
            if should_save:
                os.makedirs(self._ranks_folder, exist_ok=True)
                np.save(self._ranks_folder / f"{k}_rank.npy", self.rank_mat[k])
                np.save(self._ranks_folder / f"{k}_rank_ids.npy", self.rank_ids[k])

    def remove(self, tf_id: str, should_update_ranks: bool = False, should_save: bool = True):
        """
        Remove a TF ID from all k-mer matrices
        """
        for k in self.kmers.copy():
            if k in self.abs_ids and tf_id in self.abs_ids[k]:
                abs_idx = np.where(self.abs_ids[k] == tf_id)[0][0]
                self.abs_mat[k] = np.delete(self.abs_mat[k], abs_idx, axis=0)
                self.abs_ids[k] = np.delete(self.abs_ids[k], abs_idx, axis=0)
                if should_save:
                    os.makedirs(self._abs_folder, exist_ok=True)
                    # if table is empty, remove files
                    if self.abs_mat[k].shape[0] == 0:
                        (self._abs_folder / f"{k}_abs.npy").unlink(missing_ok=True)
                        (self._abs_folder / f"{k}_abs_ids.npy").unlink(missing_ok=True)
                        self.kmers.discard(k)
                    else:
                        np.save(self._abs_folder / f"{k}_abs.npy", self.abs_mat[k])
                        np.save(self._abs_folder / f"{k}_abs_ids.npy", self.abs_ids[k])
            if should_update_ranks and k in self.rank_ids and tf_id in self.rank_ids[k]:
                ranks_idx = np.where(self.rank_ids[k] == tf_id)[0][0]
                self.rank_mat[k] = np.delete(self.rank_mat[k], ranks_idx, axis=0)
                self.rank_ids[k] = np.delete(self.rank_ids[k], ranks_idx, axis=0)
                if should_save:
                    os.makedirs(self._ranks_folder, exist_ok=True)
                    if self.rank_mat[k].shape[0] == 0:
                        (self._ranks_folder / f"{k}_rank.npy").unlink(missing_ok=True)
                        (self._ranks_folder / f"{k}_rank_ids.npy").unlink(missing_ok=True)
                        self.kmers.discard(k)
                    else:
                        np.save(self._ranks_folder / f"{k}_rank.npy", self.rank_mat[k])
                        np.save(self._ranks_folder / f"{k}_rank_ids.npy", self.rank_ids[k])

    def copy(self):
        """
        Create a deep copy of the TFIdentifier object
        """
        return TFIdentifier(other=self)

    def __add__(self, other):
        """
        Combine two TFIdentifier objects by concatenating their
        absolute/rank matrices (per k), exactly like the old implementation.

        Shared rank files are NOT overwritten — this is a pure in-memory merge.
        """
        # Start with a deep copy of self
        merged = self.copy()
        # Merge k-mer sets
        merged.kmers = self.kmers | other.kmers

        for k in merged.kmers:
            # Merge ABSOLUTE
            if k in other.abs_mat:
                if k in self.abs_mat:
                    merged.abs_mat[k] = np.vstack([self.abs_mat[k], other.abs_mat[k]])
                    merged.abs_ids[k] = np.concatenate([self.abs_ids[k], other.abs_ids[k]])
                else:
                    merged.abs_mat[k] = other.abs_mat[k].copy()
                    merged.abs_ids[k] = other.abs_ids[k].copy()

            # Merge RANKS
            if k in other.rank_mat:
                if k in self.rank_mat:
                    merged.rank_mat[k] = np.vstack([self.rank_mat[k], other.rank_mat[k]])
                    merged.rank_ids[k] = np.concatenate([self.rank_ids[k], other.rank_ids[k]])
                else:
                    merged.rank_mat[k] = other.rank_mat[k].copy()
                    merged.rank_ids[k] = other.rank_ids[k].copy()

        return merged
