# import sys
# sys.path.append(r"C:\Users\tamirav.WISMAIN\OneDrive - weizmann.ac.il\Ariel Afek\chips\code")
import os
import pickle

import bindline


def take_top_mers(file_path, p):
    # open file
    with open(file_path, 'r') as f:
        escore_file = bindline.UniProbeEScoreFile(f.read())
        _, _, table = next(escore_file.parse_tables())
    # take the top
    sorted_dict = sorted(table._dict.items(), key=lambda x: x[1], reverse=True)
    top_precentile = dict(sorted_dict[:int(len(sorted_dict) / 100 * p)])  # take only the top precentile p from the dict
    return top_precentile


def make_a_dict(top_precentile, file_path):
    # take top mers and same path and make it a new dict
    key_lst = list(top_precentile.keys())
    file_path_lst = [[file_path]] * len(key_lst)
    new_dict = []
    for (eightMer, path) in zip(key_lst, file_path_lst):
        new_dict.append((eightMer, path))
    new_dict = dict(new_dict)
    return new_dict


def merge_dicts(new_dict, new_dict2):
    unique1 = set(list(new_dict.keys())) - set(list(new_dict2.keys()))
    unique2 = set(list(new_dict2.keys())) - set(list(new_dict.keys()))
    intersect = set(list(new_dict.keys())) & set(list(new_dict2.keys()))

    DICT = []
    for key in unique1:
        DICT.append((key, new_dict[key]))
    for key in intersect:
        DICT.append((key, new_dict[key] + new_dict2[key]))
    for key in unique2:
        DICT.append((key, new_dict2[key]))
    return dict(DICT)


# scan Bulyk files and take top precentile

percentile = 1
main_dict = {}
# Set the directory path
directory_path = r'uploads\escore\bulyk'  # replace with your directory path

# Traverse all folders and files within the directory
for root, dirs, files in os.walk(directory_path):
    for file in files:
        # Check if the file has a .txt extension
        if file.endswith('.txt'):
            file_path = (os.path.join(root, file)) # save the file path
            print(file_path)
            # Open the txt file and take top percentile mers
            top_percentile = take_top_mers(file_path, percentile)
            # make it a dict with the file name as values and mers as keys
            this_file_dict = make_a_dict(top_percentile, file_path)
            # merge it with the existing dict
            main_dict = merge_dicts(main_dict, this_file_dict)

print(main_dict)


with open(os.path.join('uploads', 'main_dict.pkl'), 'wb') as file:
    pickle.dump(main_dict, file)
