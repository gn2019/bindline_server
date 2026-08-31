import * as S from "./plot_utils.js";
import * as UTILS from "./utils.js";
import { addSequenceRow } from './sequences_table.js';

$('#existing_score').on('select2:open', S.handleSelect2Paste);
$('#pfam-select').on('select2:open', S.handleSelect2Paste);

UTILS.getElementByIdOrThrow('toggle-wt-center').addEventListener('change', S.animateAllMutants);
UTILS.getElementByIdOrThrow('toggle-group-pfam').addEventListener('change', S.groupPfams);
// Call this function on page load to initialize file lists
S.loadExistingFiles();
UTILS.getElementByIdOrThrow('load-sequences').addEventListener('click', S.loadSequences);
UTILS.getElementByIdOrThrow('add-sequence-row').addEventListener('click', () => addSequenceRow(name = `seq_${Math.floor(Math.random() * 99999999)}`));
// Handle uploading and plotting data from multiple E-Score files
UTILS.getElementByIdOrThrow('upload-and-plot').addEventListener('click', S.uploadAndPlot);
// Manage tab change
document.addEventListener("DOMContentLoaded", S.manageModeViews);
// Show cookies notice
document.addEventListener("DOMContentLoaded", S.showCookiesNotice);
// Verify the plots take the right width when tab is changed
document.addEventListener("shown.bs.tab", e => S.resizePlotsInTab(e.target.hash));
// import data on click
UTILS.getElementByIdOrThrow('import-btn').addEventListener('click', S.importLocalFile);

// apply hideThresholds on page load and on change of radio buttons
S.hideThresholds();
// show tooltips where defined
S.initTooltips();
S.getRadio("file_type").forEach(radio => {
    radio.addEventListener('change', S.hideThresholds);
});

// Apply functionality to both sliders and inputs
for (let threshold of ['escore', 'zscore', 'iscore', 'ranks']) {
    S.toggleSliderAndInput(`enable_${threshold}_threshold`, `${threshold}_threshold_slider`, `${threshold}_threshold_input`);
    S.syncSliderAndInput(`${threshold}_threshold_slider`, `${threshold}_threshold_input`);
}
