# Notes to Anki
Convert your Obsidian notes into Anki flashcards.

## Features
This plugin 

## Installation
- Manual
    - Create a folder named `notes-to-anki` under `YOUR_VAULT_NAME/.obsidian/plugins`.
    - Place `manifest.json`, `main.js`, and `style.css` from the latest release into the folder.
    - Enable it through the "Community plugin" setting tab.
- Using [BRAT](https://github.com/TfTHacker/obsidian42-brat])

> [!Note]
>
> This plugin is intended for personal use, and may not be generalisable to many note structures.

## Set up
> [!Note]
>
> This plugin requires [Anki connect](https://ankiweb.net/shared/info/2055492159) to function.

- In the settings, enter your desired deck name, note type name and AnkiConnect port number. Port only needs to be entered manually if it has already been changed in AnkiConnect (accessible through `tools -> Add-ons -> AnkiConnect)
- Specify the GUID property key for Obsidian notes. This plugin requires each note to have a unique property, so that it can update Anki flashcards when note content changes.
- Specify the properties and callouts from your notes that you would like to save to Anki.
- Specify the inclusion and exclusion criteria for notes. Currently only supports tags. Leave blank to include all notes with a valid GUID key.
- Use the commands `Sync current note to Anki` and `Sync notes by include / exclude tags` to begin syncing.