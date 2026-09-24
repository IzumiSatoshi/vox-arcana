# Offline language download button

Added an English/Japanese Settings button under the offline recognition preference. It checks the selected recognition language with SpeechRecognition.available({langs, processLocally:true}), installs only on a user click, verifies installation, and updates the Voice language cache. The preference is not enabled automatically; installed status explains how to enable it.

Handles unsupported browsers, unavailable packs, checking/downloading/installed states, failed downloads with retry, duplicate clicks, and language changes while requests or downloads are pending. Installation is called directly from the click handler before any await. No fabricated percentage is displayed because the API does not provide byte progress.

Validation: 46 tests pass across download, recognition, feedback and game casting suites. Syntax checks pass. Chrome Settings visibly shows the enabled Japanese download button and downloadable status. No language pack was downloaded during UI verification; the user requested the button and can click it to initiate installation. Settings was left open.

Only the download UI and wiring hunks in shared index.html/main.js are staged. Concurrent unrelated work is preserved.
