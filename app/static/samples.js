window.addEventListener('DOMContentLoaded', () => {
    const sampleId = new URLSearchParams(window.location.search).get('sample_id');
    switch (sampleId) {
        case '1':
            sample1();
            break;
        case '2':
            sample2();
            break;
        case '3':
            sample3();
            break;
    }
});


async function waitForOption(selectBox, value, interval = 50) {
    while (true) {
        if (selectBox && [...selectBox.options].some(o => o.text === value)) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, interval));
    }
}


async function setSelect2BoxValue(elementId, choices) {
    const selectBox = document.getElementById(elementId);
    for (const choice of choices) {
        await waitForOption(selectBox, choice).then(() => {
            const option = [...selectBox.options].find(o => o.text === choice);
            option.selected = true;
        });
    }
    // make the value appear in the select2 box
    $(selectBox).trigger('change');
}


function setCheckboxValue(elementId, isChecked=true) {
    const checkbox = document.getElementById(elementId);
    checkbox.checked = isChecked;
    checkbox.dispatchEvent(new Event("change"));
}


function setRadioValue(name, value) {
    const radios = document.getElementsByName(name);
    radios.forEach(radio => {
        if (radio.value === value) {
            radio.checked = true;
        }
        radio.dispatchEvent(new Event("change"));
    });
}


function setNumberValue(elementId, number) {
    const numberInput = document.getElementById(elementId);
    numberInput.value = number;
}


function setSequences(sequences) {
    for (const [name, value] of Object.entries(sequences)) {
        addSequenceRow(name, value);
    }
}


function pressButton(elementId) {
    const button = document.getElementById(elementId);
    button.click();
}


async function setExistingScore(choices) {
    if (!Array.isArray(choices)) {
        choices = [choices];
    }
    await setSelect2BoxValue('existing_score', choices);
}


function send() {
    pressButton('upload-and-plot');
}


function setSearchBindingSites() {
    pressButton('score-search-nav');
}


function setSearchSignificatMutations() {
    setCheckboxValue('search-significant-mutations');
}


function setShowDiffOnly() {
    setCheckboxValue('show-diff-only');
}


function setScoreThreshold(scoreType, value) {
    setRadioValue('file_type', scoreType);
    setCheckboxValue(`enable_${scoreType}_threshold`);
    setNumberValue(`${scoreType}_threshold_input`, value);
}


function setRankThreshold(value) {
    setCheckboxValue('enable_ranks_threshold');
    setNumberValue('ranks_threshold_input', value);
}


function setTabbedView() {
    setRadioValue('view-option', 'tabbed');
}


async function sample1() {
    await setExistingScore('Sum1-11');
    setSequences({
        'GPD Promoter': 'TCAGTTCGAGTTTATCATTATCAATACTGCCATTTCAAAGAATACGTAAATAATTAATAGTAGTGATTTTCCTAACTTTATTTAGTCAAAAAATTAGCCTTTTAATTCTGCTGTAACCCGTACATGCCCAAAATAGGGGGCGGGTTACACAGAATATATAACATCGTAGGTGTCTGGGTGAACAGTTTATTCCTGGCATCCACTAAATATAATGGAGCCCGCTTTTTAAGCTGGCATCCAGAAAAAAAAAGAATCCCAGCACCAAAATATTGTTTTCTTCACCAACCATCAGTTCATAGGTCCATTCTCTTAGCGCAACTACAGAGAACAGGGGCACAAACAGGCAAAAAACGGGCACAACCTCAATGGAGTGATGCAACCTGCCTGGAGTAAATGATGACACAAGGCAATTGACCCACGCATGTATCTATCTCATTTTCTTACACCTTCTATTACCTTCTGCTCTCTCTGATTTGGAAAAAGCTGAAAAAAAAGGTTGAAACCAGTTCCCTGAAATTATTCCCCTACTTGACTAATAAGTATATAAAGACGGTAGGTATTGATTGTAATTCTGTAAATCTATTTCTTAAACTTCTTAAATTCTACTTTTATAGTTAGTCTTTTTTTTAGTTTTAAAACACCAAGAACTTAGTTTCGAATAAACACACATAAACAAACAAA',
        'GPD Promoter - no AT islands': 'TCAGTTCGAGTTTATCATTATCAATACTGCCATTTCAAAGAATACGTAAACTAATCTAATAGTAGTGATTTTCCTAACTTTACTTTAGTCAAAACAATTAGCCTTTTCAATTCTGCTGTAACCCGTACATGCCCAAAATAGGGGGCGGGTTACACAGAATACTATAACATCGTAGGTGTCTGGGTGAACAGTTTATTCCTGGCATCCACTAAACTATAATGGAGCCCGCTTTTTAAGCTGGCATCCAGAAAACAAAAAGAATCCCAGCACCAAAACTATTGTTTTCTTCACCAACCATCAGTTCATAGGTCCATTCTCTTAGCGCAACTACAGAGAACAGGGGCACAAACAGGCAAAAAACGGGCACAACCTCAATGGAGTGATGCAACCTGCCTGGAGTAAATGATGACACAAGGCAATTGACCCACGCATGTATCTATCTCATTTTCTTACACCTTCTATTACCTTCTGCTCTCTCTGATTTGGAAAAAGCTGAAAACAAAAGGTTGAAACCAGTTCCCTGAAATCTATTCCCCTACTTGACTAATAAGTATACTAAAGACGGTAGGTATTGATTGTAATTCTGTAAATCTATTTCTTAAACTTCTTAAATTCTACTTTTATAGTTAGTCTTTTCTTTTAGTTTTCAAAACACCAAGAACTTAGTTTCGAATAAACACACATAAACAAACAAA'
    });
    send();
}


function sample2() {
    setSequences({'LacI_O1': 'AATTGTGAGCGGATAACAATT'});
    setSearchBindingSites();
    setRankThreshold(99.9);
    send();

}


async function sample3() {
    await setExistingScore('Fox3_Tmel');
    setSequences({'Alu': 'GCCGGGCGCGGTGGCGCGTGCCTGTAGTCCCAGCTACTCGGGAGGCTGAGGCTGGAGGATCGCTTGAGTCCAGGAGTTCTGGGCTGTAGTGCGCTATGCCGATCGGAATAGCCACTGCACTCCAGCCTGGGCAACATAGCGAGACCCCGTCTC'});
    setSearchSignificatMutations();
    setShowDiffOnly();
    setScoreThreshold('zscore', 12);
    setTabbedView();
    send();
}
