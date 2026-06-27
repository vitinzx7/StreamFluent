// Responsibility: store the words you clicked and export them to Anki.
//
// STEP 4 (your turn): save the word (chrome.storage comes in here — and only
// here is where you'll need to request the "storage" permission in the
// manifest, when the time comes) and generate the CSV export.
//
// Principle of least privilege: only request a permission when the code that
// uses it exists. A lean manifest = a safer extension that's easier to approve.

export {};
