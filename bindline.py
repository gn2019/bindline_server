import functools
import itertools
import os
import re
import zipfile
from io import StringIO

import pandas as pd
import seqlogo
import numpy as np
from matplotlib import pyplot as plt
from matplotlib.gridspec import GridSpec
import pickle


EPS = 0.00001
COLS = 3

NAME_TO_BBOX = {
    '8mer': (1, 0.5),
    'pwm': (1, 0.67),
}

COLORS = ('b', 'g', 'r', 'c', 'm', 'y', 'k')

MIN_INTERESTING_SCORE = {'pwm': 0, '8mer': 0.45}
MIN_INTERESTING_DIFF = {'pwm': 3, '8mer': 0.05}
SURROUNDINGS = 15
MER8_HIGHEST = 0.45


class ExpFile:
    def __init__(self, zip_file, pwm=True, escore=True):
        self.zip_ref = zipfile.ZipFile(zip_file, 'r')
        self.pwm = pwm
        self.escore = escore

    def namelist(self):
        return self.zip_ref.namelist()

    def read(self, name):
        return self.zip_ref.read(name).decode('utf8')

    def get_pwm_file_type(self):
        raise NotImplementedError

    def get_escore_file_type(self):
        raise NotImplementedError

    def get_pwm_files(self):
        # return all pwm files in the zip
        raise NotImplementedError

    def get_escore_files(self):
        # return all escore files in the zip
        raise NotImplementedError

    def parse_pwm_files(self):
        for fn in self.get_pwm_files():
            yield fn, self.get_pwm_file_type()(self.read(fn))

    def parse_escore_files(self):
        for fn in self.get_escore_files():
            yield fn, self.get_escore_file_type()(self.read(fn))

    def iterfiles(self):
        if self.pwm:
            yield from self.parse_pwm_files()
        if self.escore:
            yield from self.parse_escore_files()

    def itertables(self, relevant_proteins=None):
        for fn, result_file in self.iterfiles():
            for name, motif, table in result_file.parse_tables(relevant_proteins=relevant_proteins):
                yield fn, name, motif, table

    def get_table_type_by_file(self, result_file):
        if isinstance(result_file, PWMFile):
            return PWMTable
        elif isinstance(result_file, EScoreFile):
            return EScoreTable
        else:
            raise ValueError('Unknown file type')

    def close(self):
        self.zip_ref.close()
        self.zip_ref = None

    def __del__(self):
        self.zip_ref.close()


class Cisbp(ExpFile):
    NAME_MOTIF_PATTERN = r'''TF Name\t(\w+)\nGene\t\w+\nMotif\t([\w\.]+)'''

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._motif_to_name_dict = None

    def get_pwm_files(self):
        return [i for i in self.namelist() if i == 'PWM.txt']

    def get_escore_files(self):
        return [i for i in self.namelist() if i == 'EScore.txt']

    def get_motif_to_name_dict(self):
        if self._motif_to_name_dict is None:
            try:
                content = self.read('PWM.txt')
                self._motif_to_name_dict = {i[1]: i[0] for i in re.findall(self.NAME_MOTIF_PATTERN, content)}
            except:
                self._motif_to_name_dict = {}
        return self._motif_to_name_dict

    def get_pwm_file_type(self):
        return CisbpPWMFile

    def get_escore_file_type(self):
        return CisbpEScoreFile


class UniProbe(ExpFile):
    def get_pwm_files(self):
        return [i for i in self.namelist() if 'pwm' in i.lower()]

    def get_escore_files(self):
        return [i for i in self.namelist() if '8mer' in i.lower() and 'enrich' not in i.lower()]

    def get_pwm_file_type(self):
        return UniProbePWMFile

    def get_escore_file_type(self):
        return UniProbeEScoreFile


class ResultFile:
    def __init__(self, content):
        self.content = content

    def get_tables(self, relevant_proteins=None):
        raise NotImplementedError

    def get_table_type(self):
        raise NotImplementedError

    def parse_tables(self, relevant_proteins=None):
        for name, motif, table in self.get_tables(relevant_proteins=relevant_proteins):
            yield name, motif, self.get_table_type()(table)


class PWMFile(ResultFile):
    def get_table_type(self):
        return PWMTable


class CisbpPWMFile(PWMFile):
    def get_tables(self, relevant_proteins=None):
        pwm_part = self.content.split('\n\n')
        for pwm in pwm_part:
            if not pwm.strip(): continue
            header, pwm_table = pwm.split('Pos	A	C	G	T', 1)
            pwm_table = pwm_table.strip()
            if not pwm_table: continue
            header_dict = {k: v for k, v in [x.split('\t') for x in header.strip().split('\n')]}
            name, motif = header_dict['TF Name'], header_dict['Motif']
            if relevant_proteins and name.lower() not in relevant_proteins:
                continue
            # for each row in pwm remove the first element
            pwm_table = [i.split('\t', 1)[1] for i in pwm_table.split('\n')]
            # switch rows and columns
            pwm_table = ['\t'.join(i) for i in zip(*[i.split('\t') for i in pwm_table])]
            yield name, motif, pwm_table


class UniProbePWMFile(PWMFile):
    def get_tables(self, relevant_proteins=None):
        content = self.content
        while content:
            table = None
            lines = content.strip('\n\r\t ').split('\n')
            # if the first line starts with some nucleotide then ':', it is a pwm table
            if len(lines[0]) > 1 and lines[0][1] == ':':
                # read 4 lines, each line is a nucleotide
                table = lines[:4]
                # sort alphabetically
                table = sorted(table, key=lambda x: x[0])
                # remove the first letters, like 'A:', and the spaces
                table = [i[2:].strip() for i in table]

            # skip other table types
            elif lines[0] in ('Energy matrix for enoLOGOS', 'Reverse complement matrix for enoLOGOS'):
                content = '\n'.join(lines[7:])
            elif lines[0] in ('Enrichment score matrix',):
                content = '\n'.join(lines[6:])

            # if the line doesn't start with a float number, it should be skipped
            elif not lines[0].startswith('0'):
                content = '\n'.join(lines[1:])
            # if the first line starts with a float number, it is a pwm matrix
            else:
                # read 4 lines
                table = lines[:4]

            if table:
                # send to func
                yield None, None, table
                # send the rest to func
                content = '\n'.join(lines[4:])


class EScoreFile(ResultFile):
    def get_table_type(self):
        return EScoreTable


class ZScoreFile(ResultFile):
    def get_table_type(self):
        return ZScoreTable


class IScoreFile(ResultFile):
    def get_table_type(self):
        return IScoreTable


class CisbpEScoreFile(EScoreFile):
    def __init__(self, content, motif_to_name_dict=None):
        super().__init__(content)
        self._motif_to_name_dict = motif_to_name_dict

    def get_tables(self, relevant_proteins=None):
        escore = pd.read_csv(StringIO(self.content.replace('\r', '')), sep='\t')
        escore["rev"] = escore["joinID"].str.replace(
            'A', 't').str.replace('T', 'a').str.replace('C', 'g').str.replace('G', 'c').str[::-1].str.upper()
        # not "joinID" and not "rev" columns
        for col in escore.columns[1:-1]:
            name_ext = col.split(':')[2].split('=')[0]
            name = name_ext.split('_')[0]
            if name.isdigit():
                name = self._motif_to_name_dict.get(col.split(':')[0]) or name
            if relevant_proteins and name.lower() not in relevant_proteins:
                continue
            escore_table = escore[["joinID", "rev", col]].to_csv(sep='\t', header=None, index=None)
            yield name, name_ext, escore_table


class UniProbeEScoreFile(EScoreFile):
    def get_tables(self, relevant_proteins=None):
        yield None, None, self.content


class UniProbeZScoreFile(ZScoreFile):
    def get_tables(self, relevant_proteins=None):
        yield None, None, self.content


class UniProbeIScoreFile(IScoreFile):
    def get_tables(self, relevant_proteins=None):
        yield None, None, self.content


class ResultTable:
    def __init__(self, table):
        self._table = table

    def score(self, seq):
        raise NotImplementedError

    def score_seqs(self, seqs):
        return {name: (seq, self.score(seq)) for name, seq in seqs.items()}

    def highest_score(self):
        raise NotImplementedError


class PWMTable(ResultTable):
    def __init__(self, table):
        if type(table[0]) == bytes:
            table = map(lambda x: x.decode('utf8'), table)
        table = np.loadtxt(table)
        if not self.is_valid_prob_mat(table):
            raise ValueError('Invalid pwm table!')
        table = self.remove_zeros_and_normalize(table)
        self._prob_table = table
        # pwm_mat is a probability matrix, so we need to convert it to a log-odds matrix
        super().__init__(np.log2(table / 0.25))

    @staticmethod
    def is_valid_prob_mat(table):
        # validate all columns sum to 1
        if not np.allclose(np.sum(table, axis=0), 1, atol=0.01):
            return False
        # validate all values are between 0 and 1
        if not np.all((table >= 0 - EPS) & (table <= 1 + EPS)):
            return False
        return True

    @staticmethod
    def remove_zeros_and_normalize(table):
        # to each column with zeros, add EPS to zeros and normalize
        table = table.copy()
        table[table == 0] = EPS
        table = table / np.sum(table, axis=0)
        return table

    def to_logo(self):
        return logo_from_ppm(self._prob_table)

    def score(self, seq):
        scores = np.zeros(len(seq) - self._table.shape[1] + 1)
        # for each position in the sequence
        for i in range(len(seq) - self._table.shape[1] + 1):
            # calculate the score of the motif
            score = 0
            for j in range(self._table.shape[1]):
                score += self._table['ACGT'.index(seq[i + j]), j]
            scores[i] = score
        return scores

    def highest_score(self):
        return self._table.max(axis=0).sum()


class EScoreTable(ResultTable):
    def __init__(self, table, score_type='E'):
        self._dict = mer8_to_dict(table, score_type=score_type)
        self._mer = len(next(iter(self._dict)))
        super().__init__(table)

    def score(self, seq):
        scores = np.zeros(len(seq) - self._mer + 1)
        # for each position in the sequence
        for i in range(scores.shape[0]):
            # calculate the score of the motif
            scores[i] = self._dict.get(seq[i:i + self._mer], None)  # TODO: None?
        return scores

    def max_score(self):
        return max(self._dict.values())

    @functools.lru_cache(maxsize=1000)
    def rank_threshold(self, relative_threshold):
        # get the threshold of the relative threshold
        sorted_scores = sorted(self._dict.values())
        return sorted_scores[int(len(sorted_scores) * relative_threshold / 100)]



class ZScoreTable(EScoreTable):
    def __init__(self, table):
        super().__init__(table, score_type='Z')


class IScoreTable(EScoreTable):
    def __init__(self, table):
        super().__init__(table, score_type='I')


class PlottingData:
    def __init__(self, typ, outer_file, inner_file, name, motif, scores, logo, highest_score, is_interesting):
        self.typ = typ
        self.outer_file = outer_file
        self.inner_file = inner_file
        self.name = name
        self.motif = motif
        self.scores = scores
        self.logo = logo
        self.highest_score = highest_score
        self.is_interesting = is_interesting

    @classmethod
    def from_table(cls, outer_file, inner_file, name, motif, table, seqs):
        typ = 'pwm' if isinstance(table, PWMTable) else '8mer'
        scores = table.score_seqs(seqs)
        highest = 0.5 if typ == '8mer' else table.highest_score()
        return cls(
            typ=typ,
            outer_file=outer_file,
            inner_file=inner_file,
            name=name,
            motif=motif,
            scores=scores,
            logo=table.to_logo() if typ == 'pwm' else None,
            highest_score=highest,
            is_interesting=is_interesting(scores, typ, highest)
        )


class ScorePlotterLegend:
    def __init__(self):
        self._handles = []
        self._labels = []
        self._legend_set = set()

    def add(self, label, linestyle=None, color=None):
        append = linestyle or color
        assert append, "Linestyle or color must be supplied"
        if append in self._legend_set:
            return
        if linestyle:
            h = plt.plot([], [], linestyle=linestyle, color="k")[0]
        else:
            h = plt.plot([], [], linestyle="-", color=color)[0]
        self._handles.append(h)
        self._labels.append(label)
        self._legend_set.add(append)

    def get_handles_labels(self):
        return self._handles, self._labels

class ScorePlotter:
    Y_AXIS_LABEL = {'8mer': 'E-Score', 'pwm': 'Log odds'}
    def __init__(self, rows, cols=COLS, colors=COLORS):
        self._max_mers_idx = 0
        self.fig = plt.figure()
        self._gs = create_gs(rows, cols)
        self._cols = cols
        self._logo_idx = cols
        self._colors = itertools.cycle(colors)
        self._color = next(self._colors)
        self.colors_legend = ScorePlotterLegend()
        self.lines_legend = ScorePlotterLegend()

    def plot_wt(self, scores, label, **kwargs):
        self.plot(scores, color_label=label, linestyle_label='WT',
                  alpha=0.5, color=self._color, **kwargs)

    def add_to_legend(self, linestyle, color, linestyle_label=None, color_label=None):
        self.colors_legend.add(color_label, color=color)
        self.lines_legend.add(linestyle_label, linestyle=linestyle)


    def plot(self, *args, **kwargs):
        self.add_to_legend(kwargs.get('linestyle', '-'), kwargs.get('color', 'k'),
                           linestyle_label=kwargs.pop('linestyle_label', None),
                           color_label=kwargs.pop('color_label', None))
        self.fig.gca().plot(*args, **kwargs)

    def plot_table(self, plotting_data):
        if plotting_data.typ == 'pwm':
            self.plot_scores(plotting_data.scores, plotting_data.name). \
                plot_highest_score(plotting_data.highest_score, plotting_data.name). \
                plot_logo(plotting_data.logo)
        elif plotting_data.typ == '8mer':
            self.plot_scores(plotting_data.scores, plotting_data.name). \
                plot_highest_score(plotting_data.highest_score, plotting_data.name). \
                plot_all_max_mers(plotting_data.scores)
        else:
            raise ValueError('Unknown type')
        self.next_color()
        return self

    def finish_by_data(self, plotting_data, show=False):
        self.finish(plotting_data.outer_file, plotting_data.inner_file, plotting_data.name, plotting_data.motif,
                    plotting_data.typ, is_interesting=plotting_data.is_interesting, show=show)

    @classmethod
    def plot_all(cls, plotting_data: PlottingData, plotter, finish, show):
        if not plotter:
            if plotting_data.typ == 'pwm':
                plotter = cls(3)
            elif plotting_data.typ == '8mer':
                plotter = cls(2)
            else:
                raise ValueError('Unknown type')

        plotter.plot_table(plotting_data)
        if finish:
            plotter.finish_by_data(plotting_data, show)
        return plotter



    def plot_scores(self, seqs_scores, name):
        for seq_name, (seq, scores) in seqs_scores.items():
            is_del = seq_name.startswith('del')
            if is_del:
                wt = seq_name.replace('del', 'WT')
                self.plot_del(scores, seqs_scores[wt][1], label=name)
            else:
                self.plot_wt(scores, label=name)

        return self

    def axhline(self, *args, **kwargs):
        self.add_to_legend(kwargs.get('linestyle', '-'), kwargs.get('color', 'k'),
                           linestyle_label=kwargs.pop('linestyle_label', None),
                           color_label=kwargs.pop('color_label', None))
        self.fig.gca().axhline(*args, **kwargs)

    def plot_aligned(self, scores, ref_scores, label, **kwargs):
        min_i = align_scores(ref_scores, scores)
        del_size = len(ref_scores) - len(scores)
        scores = list(scores[:min_i]) + [None] * del_size + list(scores[min_i:])
        self.plot(scores, color_label=label,
                  alpha=0.5, color=self._color, **kwargs)

    def plot_del(self, scores, ref_scores, label, **kwargs):
        min_i = align_scores(ref_scores, scores)
        del_size = len(ref_scores) - len(scores)
        scores = list(scores[:min_i]) + [None] * del_size + list(scores[min_i:])
        only_del = [None] * min_i + list(ref_scores[min_i:min_i + del_size]) + [None] * (len(scores) - min_i)
        self.plot(only_del, color_label=label,
                  alpha=0.5, linestyle='-', linewidth=15, color=self._color, **kwargs)
        self.plot(scores, color_label=label, linestyle_label='del',
                  alpha=0.5, linestyle='--', color=self._color, **kwargs)

    def plot_logo(self, logo):
        if logo is not None:
            ax = plt.subplot(self._gs[self._logo_idx // self._cols, self._logo_idx % self._cols])
            ax.imshow(logo)
            plt.subplot(self._gs[0, :])
            self._logo_idx += 1
        return self

    def plot_highest_score(self, highest_score, label, **kwargs):
        self.axhline(y=highest_score, color_label=label, linestyle_label='highest',
                     alpha=0.5, linestyle=':', color=self._color, **kwargs)
        return self

    def next_color(self):
        self._color = next(self._colors)

    def finish(self, outer_file, inner_file, name, motif, typ, out_dir=None, show=False, is_interesting=False):
        if out_dir is None:
            out_dir = os.path.splitext(os.path.basename(outer_file))[0]
        if name is None:
            name = os.path.splitext(inner_file)[0]
        self.fig.gca().set_xlabel('Position in sequence')
        self.fig.gca().set_ylabel(self.Y_AXIS_LABEL.get(typ))
        # put the legend to the graph's bottom
        legend = self.fig.legend(*self.colors_legend.get_handles_labels(),
                                 loc='lower left',
                                 bbox_to_anchor=NAME_TO_BBOX[typ],
                                 fancybox=True, shadow=True)
        self.fig.gca().add_artist(legend)
        self.fig.legend(*self.lines_legend.get_handles_labels(),
                        loc='upper left',
                        bbox_to_anchor=NAME_TO_BBOX[typ],
                        fancybox=True, shadow=True)
        # enlarge the graph to the top
        self.fig.subplots_adjust(top=0.9)
        # put the actual letters of the longer sequence below the x axis
        # plt.xticks(range(len(seqs[sorted(seqs, key=lambda x: len(seqs[x]))[-1]])),
        #            sorted(seqs.values(), key=lambda x: len(x))[-1])
        # get the current title
        title = self.fig.gca().get_title()
        # set the title
        self.fig.suptitle(f'{typ.upper()}: {inner_file}')
        dir_ = typ if is_interesting else f'{typ}-non'
        fig_path = os.path.join(out_dir, dir_, name + '.png')
        os.makedirs(os.path.dirname(fig_path), exist_ok=True)
        fig_path = os.path.abspath(fig_path)
        print(f'Saving to {fig_path}')
        self.fig.savefig(fig_path, bbox_inches='tight')
        # plt.figure(figsize=(20,20))
        if show:
            plt.clf()
            img = plt.imread(fig_path)
            plt.imshow(img)
            plt.axis('off')
            plt.show()
        plt.close(self.fig)
        # input(fig_path)
        return self.fig

    def plot_all_max_mers(self, scores):
        for seq_name, (seq, seq_scores) in scores.items():
            self.plot_max_mers(seq, seq_scores, seq_name)
        return self

    def plot_max_mers(self, seq, scores, name):
        mer = len(seq) - len(scores) + 1
        # get the 3 maximal value in current scores
        filtered_scores = list(filter(None, scores))
        max_scores = sorted(filtered_scores, reverse=True)[:3]
        # get the indices of the 3 maximal values
        max_scores_idx = [i for i, j in enumerate(filtered_scores) if j in max_scores]
        # get the 3 maximal 8-mers
        # print i with two digits apter decimal point
        max_mers = [f'{seq[i:i + mer]} - {filtered_scores[i]:.3f}' for i in max_scores_idx]

        ax = plt.subplot(self._gs[1, self._max_mers_idx])
        self._max_mers_idx += 2
        # set as title
        ax.set_title(f"{name}:\n{max_mers[0]}\n{max_mers[1]}\n{max_mers[2]}")
        plt.subplots_adjust(hspace=1, wspace=1)
        plt.subplot(self._gs[0, :])
        return self


def manage_scores_file(typ, scores, interest_type, interesting_points, highest):
    scores = {k: list(v) for k, v in scores.items()}
    open(f'max_scores_{typ}.txt', 'a').write(f'({scores}, "{interest_type}", {interesting_points}, {highest})\n')


def get_interesting_del_region_points(seq_scores, wt, del_, del_reg, min_score):
    # interesting if the deletion region is higher than its surroundings
    # max in deletion region
    wt_scores, del_scores = seq_scores[wt][1], seq_scores[del_][1]
    del_size = len(wt_scores) - len(del_scores)
    assert del_size == 3
    argmax_wt_del_region = np.argmax(wt_scores[del_reg:del_reg + del_size])
    max_wt_del_region = wt_scores[del_reg + argmax_wt_del_region]
    if max_wt_del_region <= min_score:
        return

    # max wt in the deletion region
    argmax_del = np.argmax(del_scores)
    if max_wt_del_region > del_scores[argmax_del]:
        return [del_reg + argmax_wt_del_region, argmax_del + 0 if argmax_del < del_reg else del_size]


def get_interesting_diff_points(seq_scores, wt, del_, min_diff, min_score, del_reg):
    # interesting if the diff is higher than MIN_INTERESTING_DIFF
    diff = [seq_scores[wt][1][i] - del_score for i, del_score in enumerate(seq_scores[del_][1]) if del_score is not None]
    del_size = len(seq_scores[wt]) - len(diff)
    points = []
    for i in np.argwhere(np.abs(diff) > min_diff):
        diff_ind = i[0]
        relevant = wt if diff[diff_ind] > 0 else del_
        ind = (diff_ind + del_size if diff_ind >= del_reg else diff_ind) if relevant == wt else diff_ind
        if seq_scores[relevant][1][ind] <= min_score:
            continue
        wt_scores_tmp = np.concatenate([
            seq_scores[wt][1][max(ind - SURROUNDINGS, 0):ind],
            seq_scores[wt][1][ind + 1:ind + 1 + SURROUNDINGS]
        ])
        argmax_wt = np.argmax(wt_scores_tmp)
        max_wt = wt_scores_tmp[argmax_wt]
        if seq_scores[relevant][1][ind] > max_wt:
            points.append(ind)
    return points


def is_interesting(seq_scores, typ, highest):
    if typ == '8mer':
        highest = MER8_HIGHEST
    wt = [i for i in seq_scores if 'WT' in i][0]
    del_ = [i for i in seq_scores if 'del' in i][0]
    min_i = align_scores(seq_scores[wt][1], seq_scores[del_][1])

    # find the deletion region. del_reg = the first not-None index in only_del
    interest_type, interesting_points = 'reg', get_interesting_del_region_points(seq_scores, wt, del_, min_i + 1, MIN_INTERESTING_SCORE[typ])
    if not interesting_points:
        interest_type, interesting_points = 'diff', get_interesting_diff_points(seq_scores, wt, del_, MIN_INTERESTING_DIFF[typ], MIN_INTERESTING_SCORE[typ], min_i + 1)
    if interesting_points:
        manage_scores_file(typ, seq_scores, interest_type, interesting_points, highest)
        return True
    return False

def create_gs(rows, cols=COLS):
    gs = GridSpec(rows, cols, width_ratios=[1] * cols, height_ratios=[rows+1]+[1]*(rows-1))
    for i in range(cols, cols + (rows - 1) * cols):
        ax = plt.subplot(gs[i // cols, i % cols])
        # remove x and y axes
        ax.xaxis.set_visible(False)
        ax.yaxis.set_visible(False)
        # remove the frame
        for direction in ('top', 'right', 'bottom', 'left'):
            ax.spines[direction].set_visible(False)
    plt.subplot(gs[0, :])
    return gs


def logo_from_ppm(ppm):
    # create a logo from a pwm
    data = seqlogo.Ppm(ppm)
    try:
        seqlogo.seqlogo(data, ic_scale=True, format='png', size='small', filename='tmp.png')
    except:
        seqlogo.seqlogo(data, ic_scale=False, format='png', size='small', filename='tmp.png')
    logo = plt.imread('tmp.png')
    os.remove('tmp.png')
    return logo

def mer8_to_dict(mer8_content, score_type='E'):
    # mer8 file is tsv with the columns 8-mer,8-mer-rev,E-score,Median,Z-score
    # read the file into 2 dicts, one for the forward and one for the reverse
    # skip first line
    #
    # another format is of 9 columns: 8-mer sequence, Complement of 8-mer sequence, Median Intensity Signal,
    # Enrichment Score, Zscore (MAD estimation of sd), Pvalue for Zscore, Pvalue for Enrichment Score,
    # FDR Qvalue for Zscore, FDR Qvalue for Enrichment
    if type(mer8_content) == bytes:
        mer8_content = mer8_content.decode('utf8')
    mer8_content = [i.strip(' \r\n').split('\t') for i in mer8_content.strip(' \r\n').split('\n')]
    # remove header if exists
    if set(mer8_content[0][0]) - set('ACGT'):
        mer8_content = mer8_content[1:]
    # determine file format by number of columns
    cols_num = len(mer8_content[0])
    score_column = {
        3: {'E': 2},
        5: {'E': 2, 'I': 3, 'Z': 4},
        9: {'I': 2, 'E': 3, 'Z': 4},
        20: {'I': 2, 'E': 3, 'Z': 4}
     }
    if cols_num not in score_column:
        if cols_num == 4:
            score_column[cols_num] = {'E': 2, 'I': 3} if float(mer8_content[0][2]) <= 0.5 else {'I': 2, 'E': 3}
        else:
            raise ValueError('mer8 file has wrong number of columns')
    if score_type not in score_column[cols_num]:
        raise ValueError(f'No {score_type} score in the table')
    score_idx = score_column[cols_num][score_type]
    # if cols_num == 5:
    #     mer8_content = mer8_content[1:]
    mer8_dict = {i[0]: -0.5 if i[score_idx] in ('', 'NA') else float(i[score_idx]) for i in mer8_content}
    mer8_dict.update({i[1]: -0.5 if i[score_idx] in ('', 'NA') else float(i[score_idx]) for i in mer8_content})
    return mer8_dict


def align_scores(scores_wt, scores_del):
    # check where DEL_SITE Nones should be inserted to scores_del in order to get the least sum of squares
    del_size = len(scores_wt) - len(scores_del)
    scores_wt_new = scores_wt[del_size:].copy()
    min_sum = np.sum((scores_wt_new - scores_del) ** 2)
    min_i = 0
    for i in range(len(scores_del) - del_size):
        scores_wt_new[i] = scores_wt[i]
        _sum = np.sum((scores_wt_new - scores_del) ** 2)
        if _sum < min_sum:
            min_sum = _sum
            min_i = i + 1
    return min_i


def get_seqs_from_fasta(fasta_file):
    # return all sequences in fasta_file as a dict
    seqs = {}
    with open(fasta_file, 'r') as f:
        for line in f:
            if not line.strip():
                continue
            if line.startswith('>'):
                name = line[1:].strip()
                seqs[name] = ''
            else:
                seqs[name] += line.strip()
    return seqs

class TFIdentifier:
    def __init__(self, hypo_file, kmer=8):
        with open(hypo_file, 'rb') as file:
            self._dict = pickle.load(file)
        self._mer = kmer or len(next(iter(self._dict)))
    
    def identify(self, seq):
        TFs = []
        # for each position in the sequence
        for i in range(len(seq) - self._mer + 1):
            # calculate the score of the motif
            TFs.append(self._dict.setdefault(seq[i:i + self._mer], []))
        return TFs

    def __call__(self, seqs):
        return {name: (seq, self.identify(seq)) for name, seq in seqs.items()}

import time
class TFIdentifier:
    def __init__(self, absolute_hypo_file=None, rank_hypo_file=None, kmer=8):
        assert absolute_hypo_file or rank_hypo_file, "At least one of the files should be provided"
        self._mat, self._rank_mat = None, None

        if absolute_hypo_file:
            with open(absolute_hypo_file, 'rb') as file:
                self._mat = pickle.load(file)
        if rank_hypo_file:
            with open(rank_hypo_file, 'rb') as file:
                self._rank_mat = pickle.load(file)
        # length of the column names is the kmer
        self._mer = kmer or (len(next(iter(self._mat))) if self._mat else len(next(iter(self._rank_mat))))

    def __identify(self, seq):
        TFs = []
        # for each position in the sequence
        for i in range(len(seq) - self._mer + 1):
            # calculate the score of the motif
            # take the TF names which have a value in seq[i:i + self._mer] column by pandas
            TFs.append(self._threshold_mat[seq[i:i + self._mer]].dropna().index.tolist())
        return TFs

    def __call__(self, seqs, absolute_threshold=None, rank_threshold=None):
        assert absolute_threshold or rank_threshold, "At least one of the thresholds should be provided"
        assert absolute_threshold is None or self._mat is not None, "Absolute matrix is not provided"
        assert rank_threshold is None or self._rank_mat is not None, "Rank matrix is not provided"

        if rank_threshold:
            rank_threshold *= self._rank_mat.max().max() / 100
        # turn all values below threshold to nan, keep it df
        if absolute_threshold:
            self._threshold_mat = self._mat.where(self._mat >= absolute_threshold, np.nan)
            if rank_threshold:
                self._threshold_mat += self._rank_mat.where(self._rank_mat >= rank_threshold, np.nan)
        elif rank_threshold:
            self._threshold_mat = self._rank_mat.where(self._rank_mat >= rank_threshold, np.nan)

        return {name: (seq, self.__identify(seq)) for name, seq in seqs.items()}
