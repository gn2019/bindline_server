import * as UTILS from './utils.js';
import { setSequences, getRowBySequenceName, setAsRef } from './sequences_table.js';

window.addEventListener('DOMContentLoaded', () => {
    const sampleId = new URLSearchParams(window.location.search).get('sample_id');
    switch (sampleId) {
        case '1':
            Samples.sample1();
            break;
        case '2':
            Samples.sample2();
            break;
        case '3':
            Samples.sample3();
            break;
    }
});


async function waitForOption(selectBox, value, { byId=false, interval=50, timeout=10000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if ([...selectBox.options].some(o => (byId ? o.value : o.text) == value)) {
            return true;
        }
        await new Promise(r => setTimeout(r, interval));
    }
    throw new Error(`Option "${value}" not found`);
}

function clearSelect2Box(elementId) {
    const selectBox = UTILS.getElementByIdOrThrow(elementId);
    for (const option of selectBox.options) {
        option.selected = false;
    }
    selectBox.dispatchEvent(new Event("change"));
}

async function setSelect2BoxValue(elementId, choices, byId=false) {
    const selectBox = UTILS.getElementByIdOrThrow(elementId);
    for (const choice of choices) {
        await waitForOption(selectBox, choice, {byId: byId}).then(() => {
            const option = [...selectBox.options].find(o => (byId ? o.value : o.text) == choice);
            option.selected = true;
        });
    }
    // make the value appear in the select2 box
    selectBox.dispatchEvent(new Event("change"));
}


function setCheckboxValue(elementId, isChecked=true) {
    const checkbox = UTILS.getElementByIdOrThrow(elementId);
    checkbox.checked = isChecked;
    checkbox.dispatchEvent(new Event("change"));
}


function setRadioValue(name, value) {
    const radios = document.getElementsByName(name);
    radios.forEach(radio => {
        if (radio.value === value) {
            if (!radio.checked) {
                radio.checked = true;
                radio.dispatchEvent(new Event("change"));
            }
        }
    });
}


function setNumberValue(elementId, number) {
    const numberInput = UTILS.getElementByIdOrThrow(elementId);
    numberInput.value = number;
}

function pressButton(elementId) {
    const button = UTILS.getElementByIdOrThrow(elementId);
    button.click();
}

function unsetExistingScore() {
    clearSelect2Box('existing_score');
}

async function setExistingScore(choices, byId=false) {
    if (!Array.isArray(choices)) {
        choices = [choices];
    }
    await setSelect2BoxValue('existing_score', choices, byId);
}

function send() {
    pressButton('upload-and-plot');
}

function setUploadScoreFile() {
    pressButton('score-upload-nav');
}

function setExistingScoreFile() {
    pressButton('score-existing-nav');
}

function setSearchBindingSites() {
    pressButton('score-search-nav');
}

function setSearchSignificatMutations(isChecked=true) {
    setCheckboxValue('search-significant-mutations', isChecked);
}

function setShowDiffOnly(isChecked=true) {
    setCheckboxValue('show-diff-only', isChecked);
}

function setFiletype(scoreType) {
    setRadioValue('file_type', scoreType);
}

function setScoreThreshold(scoreType, value) {
    setFiletype(scoreType);
    setCheckboxValue(`enable_${scoreType}_threshold`);
    setNumberValue(`${scoreType}_threshold_input`, value);
}

function setRankThreshold(value) {
    setCheckboxValue('enable_ranks_threshold');
    setNumberValue('ranks_threshold_input', value);
}

function setStackedView() {
    setRadioValue('view-option', 'stacked');
}

function setTabbedView() {
    setRadioValue('view-option', 'tabbed');
}

function setRef(refName) {
    const row = getRowBySequenceName(refName);
    if (row) {
        setAsRef(row);
    }
}

function unsetThresholds() {
    setCheckboxValue('enable_escore_threshold', false);
    setCheckboxValue('enable_zscore_threshold', false);
    setCheckboxValue('enable_iscore_threshold', false);
    setCheckboxValue('enable_ranks_threshold', false);
}

function resetForm() {
    setScoreSource('existing');
    unsetExistingScore();
    setSequences({});
    setFiletype('escore');
    unsetThresholds();
    setShowDiffOnly(false);
    setSearchSignificatMutations(false);
    setStackedView();
}

function setScoreSource(scoreSource) {
    switch (scoreSource) {
        case 'search':
            setSearchBindingSites();
            break;
        case 'upload':
            setUploadScoreFile();
            break;
        case 'existing':
        default:
            setExistingScoreFile();
            break;
    }
}

function hideDownloadButton() {
    const exportDiv = document.getElementById('export-div');
    if (exportDiv) {
        exportDiv.classList.add('d-none');
    }
}

function importQueryData(queryData) {
    resetForm();
    hideDownloadButton();
    if (queryData.score_source != null) {
        setScoreSource(queryData.score_source);
    }
    if (queryData.score_file_ids) {
        setExistingScore(queryData.score_file_ids, true);
    }
    if (queryData.file_type != null) {
        setFiletype(queryData.file_type);
    }
    if (queryData.selected_threshold != null) {
        setScoreThreshold(queryData.file_type, queryData.selected_threshold);
    }
    if (queryData.ranks_threshold != null) {
        setRankThreshold(queryData.ranks_threshold);
    }
    if (queryData.show_diff_only) {
        setShowDiffOnly();
    }
    if (queryData.search_significant_mutations) {
        setSearchSignificatMutations();
    }
    if (queryData.sequences != null) {
        setSequences(queryData.sequences);
    }
    if (queryData.ref_name != null) {
        setRef(queryData.ref_name);
    }
}

const Samples = {
    async sample1() {
        await setExistingScore('Sum1-11');
        setSequences({
            'GPD Promoter': 'TCAGTTCGAGTTTATCATTATCAATACTGCCATTTCAAAGAATACGTAAATAATTAATAGTAGTGATTTTCCTAACTTTATTTAGTCAAAAAATTAGCCTTTTAATTCTGCTGTAACCCGTACATGCCCAAAATAGGGGGCGGGTTACACAGAATATATAACATCGTAGGTGTCTGGGTGAACAGTTTATTCCTGGCATCCACTAAATATAATGGAGCCCGCTTTTTAAGCTGGCATCCAGAAAAAAAAAGAATCCCAGCACCAAAATATTGTTTTCTTCACCAACCATCAGTTCATAGGTCCATTCTCTTAGCGCAACTACAGAGAACAGGGGCACAAACAGGCAAAAAACGGGCACAACCTCAATGGAGTGATGCAACCTGCCTGGAGTAAATGATGACACAAGGCAATTGACCCACGCATGTATCTATCTCATTTTCTTACACCTTCTATTACCTTCTGCTCTCTCTGATTTGGAAAAAGCTGAAAAAAAAGGTTGAAACCAGTTCCCTGAAATTATTCCCCTACTTGACTAATAAGTATATAAAGACGGTAGGTATTGATTGTAATTCTGTAAATCTATTTCTTAAACTTCTTAAATTCTACTTTTATAGTTAGTCTTTTTTTTAGTTTTAAAACACCAAGAACTTAGTTTCGAATAAACACACATAAACAAACAAA',
            'GPD Promoter - no AT islands': 'TCAGTTCGAGTTTATCATTATCAATACTGCCATTTCAAAGAATACGTAAACTAATCTAATAGTAGTGATTTTCCTAACTTTACTTTAGTCAAAACAATTAGCCTTTTCAATTCTGCTGTAACCCGTACATGCCCAAAATAGGGGGCGGGTTACACAGAATACTATAACATCGTAGGTGTCTGGGTGAACAGTTTATTCCTGGCATCCACTAAACTATAATGGAGCCCGCTTTTTAAGCTGGCATCCAGAAAACAAAAAGAATCCCAGCACCAAAACTATTGTTTTCTTCACCAACCATCAGTTCATAGGTCCATTCTCTTAGCGCAACTACAGAGAACAGGGGCACAAACAGGCAAAAAACGGGCACAACCTCAATGGAGTGATGCAACCTGCCTGGAGTAAATGATGACACAAGGCAATTGACCCACGCATGTATCTATCTCATTTTCTTACACCTTCTATTACCTTCTGCTCTCTCTGATTTGGAAAAAGCTGAAAACAAAAGGTTGAAACCAGTTCCCTGAAATCTATTCCCCTACTTGACTAATAAGTATACTAAAGACGGTAGGTATTGATTGTAATTCTGTAAATCTATTTCTTAAACTTCTTAAATTCTACTTTTATAGTTAGTCTTTTCTTTTAGTTTTCAAAACACCAAGAACTTAGTTTCGAATAAACACACATAAACAAACAAA'
        });
        send();
    },

    sample2() {
        setSequences({'LacI_O1': 'AATTGTGAGCGGATAACAATT'});
        setSearchBindingSites();
        setRankThreshold(99.9);
        send();

    },

    async sample3() {
        await setExistingScore('Fox3_Tmel');
        setSequences({'Alu': 'GCCGGGCGCGGTGGCGCGTGCCTGTAGTCCCAGCTACTCGGGAGGCTGAGGCTGGAGGATCGCTTGAGTCCAGGAGTTCTGGGCTGTAGTGCGCTATGCCGATCGGAATAGCCACTGCACTCCAGCCTGGGCAACATAGCGAGACCCCGTCTC'});
        setSearchSignificatMutations();
        setShowDiffOnly();
        setScoreThreshold('zscore', 12);
        setTabbedView();
        send();
    },
}
