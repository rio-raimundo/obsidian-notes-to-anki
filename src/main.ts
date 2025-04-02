import { MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import { AnkiSyncSettings, DEFAULT_SETTINGS, AnkiSyncSettingTab } from './settings';
import { logWithTag } from './auxilliary';


// Helper function to make AnkiConnect requests
async function ankiRequest<T>(url: string, action: string, params: object = {}): Promise<T> {
    const body = JSON.stringify({ action, version: 6, params });
    try {
        const response = await fetch(url, {
            method: 'POST',
            body: body,
            headers: { 'Content-Type': 'application/json' }
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        if (data.error) {
            throw new Error(`AnkiConnect Error: ${data.error}`);
        }
        return data.result;
    } catch (error) {
        console.error('AnkiConnect request failed:', error);
        new Notice(`AnkiConnect request failed: ${error.message}`);
        throw error; // Re-throw to be caught by calling function
    }
}

export default class AnkiSyncPlugin extends Plugin {
    settings: AnkiSyncSettings;

    async onload() {
        await this.loadSettings();
		this.addSettingTab(new AnkiSyncSettingTab(this.app, this));
        this.addAllCommands();

        // Check if anki deck exists; create if it does not
		await this.findAnkiDeck(this.settings.defaultDeck, true);

		logWithTag('Plugin loaded.');
    }

    onunload() {
        logWithTag('Plugin unloaded successfully.');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    addAllCommands() {
        // Add command to sync the current note
        this.addCommand({
            id: 'sync-current-note-to-anki',
            name: 'Sync current note to Anki',
            checkCallback: (checking: boolean) => {
                const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (markdownView && markdownView.file) {
                    if (!checking) {
                        this.syncNoteToAnki(markdownView.file);
                    }
                    return true;
                }
                return false;
            }
        });
    }

    async findAnkiDeck(deckName: string, createIfNotFound: boolean) {
        try {
            console.log(`Checking if Anki deck "${deckName}" exists...`);
            const existingDecks: string[] = await ankiRequest<string[]>(this.settings.ankiConnectUrl, 'deckNames');

            if (!existingDecks.includes(deckName)) {
				if (!createIfNotFound) {
					const text = `Anki deck "${deckName}" could not be found. Either create it manually, change deck name, or change setting to allow automatic creation. `
					new Notice(text);
					console.info(text);
					return;
				}

                new Notice(`Anki deck "${deckName}" not found. Creating deck automatically...`);
                console.log(`Attempting to create deck: ${deckName}`);

                // createDeck returns the new deck's ID on success, or null/error
                const createResult = await ankiRequest<number|null>(this.settings.ankiConnectUrl, 'createDeck', { deck: deckName });

                if (createResult === null) {
                     // AnkiConnect might return null even on success in some edge cases or versions
                     console.warn(`AnkiConnect returned null for creating deck "${deckName}", but proceeding. Check Anki if deck was created.`);
                } else {
                    new Notice(`Successfully created Anki deck: "${deckName}"`);
                    console.log(`Deck "${deckName}" created successfully (ID: ${createResult}).`);
                }
            } else {
                console.log(`Anki sync: Found existing anki deck "${deckName}"!`);
            }
        } catch (error) {
            console.error(`Error checking or creating Anki deck "${deckName}":`, error);
            // Provide more specific feedback if possible
            if (error.message && error.message.includes("deck name conflicts with existing model")) {
                 new Notice(`Error: Deck name "${deckName}" conflicts with an existing Anki Note Type name. Please choose a different deck name.`);
            } else {
                 new Notice(`Failed to ensure Anki deck "${deckName}" exists. Check Anki/AnkiConnect. Error: ${error.message || error}`);
            }

            // Stop the sync process if deck handling fails critically
            return; // Exit the sync function
        }
    }

    // --- Core Sync Logic ---
    async syncNoteToAnki(file: TFile) {
        new Notice(`Syncing "${file.basename}" to Anki...`);

        try {
            const fileContent = await this.app.vault.read(file);
            const fileCache = this.app.metadataCache.getFileCache(file);
            const frontmatter = fileCache?.frontmatter || {};

            // 1. Get unique ID
            const guid = frontmatter[this.settings.obsidianGuidProperty];

            // 2. Extract Summary Callout
            const summary = this.extractSummaryCallout(fileContent, this.settings.summaryCalloutLable);
            if (!summary) {
                new Notice(`Warning: No [!${this.settings.summaryCalloutLable}] callout found in "${file.basename}". Using empty summary.`);
            }

            // 3. Prepare Anki Note Fields
            const ankiFields: { [key: string]: string } = {};

            // Map properties based on settings
            for (const obsProp in this.settings.fieldMappings) {
                const ankiField = this.settings.fieldMappings[obsProp];
                if (obsProp === 'summaryCallout') {
                    ankiFields[ankiField] = summary || ''; // Assign extracted summary
                } else if (frontmatter[obsProp]) {
                    // Handle potential arrays (like authors, tags)
                    ankiFields[ankiField] = Array.isArray(frontmatter[obsProp])
                        ? frontmatter[obsProp].join(', ') // Join arrays with comma
                        : String(frontmatter[obsProp]); // Convert others to string
                } else {
                    ankiFields[ankiField] = ''; // Default to empty if property doesn't exist
                }
            }

            // Add GUID field (mandatory)
            ankiFields[this.settings.ankiGuidField] = guid;

            // Add Obsidian Link (optional but good)
            const obsidianLink = `obsidian://open?vault=${encodeURIComponent(this.app.vault.getName())}&file=${encodeURIComponent(file.path)}`;
            // Assuming you have an 'ObsidianLink' field in your Anki Note Type
            if (!this.settings.fieldMappings.hasOwnProperty('obsidianLink')) { // Check if a mapping exists
                 ankiFields['ObsidianLink'] = obsidianLink; // Or use a configurable field name
            } else {
                 ankiFields[this.settings.fieldMappings['obsidianLink']] = obsidianLink;
            }


            // Add Default Front field if not mapped
            if (!ankiFields['Front'] && !this.settings.fieldMappings.hasOwnProperty('front')) { // Check if 'Front' is explicitly mapped
                 ankiFields['Front'] = file.basename; // Default Front to note title
            }


            // 4. Check if Anki Note Exists (using GUID)
            const findNotesResult = await ankiRequest<number[]>(this.settings.ankiConnectUrl, 'findNotes', {
                query: `deck:"${this.settings.defaultDeck}" "${this.settings.ankiGuidField}:${guid}"`
            });

            let ankiNoteId: number | null = null;
            if (findNotesResult && findNotesResult.length > 0) {
                ankiNoteId = findNotesResult[0];
                console.log(`Found existing Anki note (ID: ${ankiNoteId}) for GUID: ${guid}`);
            }

            // 5. Add or Update Anki Note
            if (ankiNoteId !== null) {
                // Update existing note
                await ankiRequest(this.settings.ankiConnectUrl, 'updateNoteFields', {
                    note: {
                        id: ankiNoteId,
                        fields: ankiFields
                    }
                });
                new Notice(`Updated Anki note for "${file.basename}"`);
            } else {
                // Add new note
                const addNoteResult = await ankiRequest(this.settings.ankiConnectUrl, 'addNote', {
                    note: {
                        deckName: this.settings.defaultDeck,
                        modelName: this.settings.noteTypeName,
                        fields: ankiFields,
                        tags: frontmatter.tags || [] // Add tags from frontmatter if they exist
                    }
                });
                new Notice(`Added new Anki note for "${file.basename}" (ID: ${addNoteResult})`);
            }

        } catch (error) {
            console.error('Error syncing note to Anki:', error);
            new Notice(`Error syncing "${file.basename}" to Anki. Check console (Ctrl+Shift+I) and ensure AnkiConnect is running.`);
        }
    }

    // --- Helper Functions ---

    extractSummaryCallout(content: string, label: string): string | null {
        // Regex to find the specific callout and capture its content
        // Handles multiline content within the callout
        console.log('trying to handle summary callout')
        const calloutRegex = new RegExp(`^> \\[!${label}\\](?:[^\r\n]*)?\r?\n((?:>.*\r?\n?)*)`, 'im');
        const match = content.match(calloutRegex);

        if (match && match[1]) {
            // Remove the leading '> ' from each line of the captured content
            return match[1].split(/\r?\n/)
                .map(line => line.replace(/^>\s?/, ''))
                .join('\n').trim();
        }
        return null;
    }

    async saveGuidToFrontmatter(file: TFile, guid: string) {
        try {
            await this.app.fileManager.processFrontMatter(file, (fm) => {
                fm[this.settings.obsidianGuidProperty] = guid;
            });
            console.log(`Saved GUID ${guid} to frontmatter of "${file.path}"`);
        } catch (error) {
            console.error(`Failed to save GUID to frontmatter for "${file.path}":`, error);
            new Notice(`Failed to save Anki GUID to "${file.basename}". Please add it manually: ${this.settings.obsidianGuidProperty}: ${guid}`);
        }
    }
}