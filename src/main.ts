import { MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import { AnkiSyncSettings, DEFAULT_SETTINGS, AnkiSyncSettingTab } from './settings';
import { logWithTag } from './auxilliary';
import { MarkdownRenderer } from 'obsidian'; // Use Obsidian's renderer


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

        this.addCommand({
            id: 'sync-notes-by-tag',
            name: 'Sync Notes by Include/Exclude Tags',
            callback: async () => {
                new Notice('Starting sync based on tags...');
    
                // 1. Get include/exclude tags from settings (provide defaults)
                //    Tags in settings should NOT have the leading '#'
                const includeTags = this.settings.tagsToInclude?.map(t => t.toLowerCase()) ?? [];
                const excludeTags = this.settings.tagsToExclude?.map(t => t.toLowerCase()) ?? [];
    
                console.log("Include Tags:", includeTags);
                console.log("Exclude Tags:", excludeTags);
    
                // 2. Get all markdown files in the vault
                const allMarkdownFiles = this.app.vault.getMarkdownFiles();
                const filesToSync: TFile[] = [];
    
                // 3. Filter files based on tags
                for (const file of allMarkdownFiles) {
                    const fileCache = this.app.metadataCache.getFileCache(file);
                    const frontmatter = fileCache?.frontmatter || {};

                    // Get tags from metadata, remove leading '#', convert to lowercase
                    // const getTags = (cache) => {}
                    const noteTags = fileCache?.tags?.map(t => t.tag.substring(1).toLowerCase()) ?? [];
                    const frontmatterTags = (frontmatter?.tags as string[])?.map(t => t.toLowerCase()) ?? [];
                    const allTags = [...noteTags, ...frontmatterTags];
    
                    // Skip if no tags found in the note when filtering is needed
                    if (!allTags.length && (includeTags.length > 0 || excludeTags.length > 0)) {
                        continue;
                    }
    
                    // Check for exclusion criteria FIRST (more efficient)
                    let isExcluded = false;
                    if (excludeTags.length > 0) {
                        isExcluded = allTags.some(noteTag => excludeTags.includes(noteTag));
                    }
    
                    if (isExcluded) {
                        // console.log(`Excluding ${file.path} due to tags: ${noteTags.join(', ')}`);
                        continue; // Skip this file
                    }
    
                    // Check for inclusion criteria
                    let isIncluded = false;
                    if (includeTags.length === 0) {
                        // If no includeTags are specified, all non-excluded notes are included
                        isIncluded = true;
                    } else {
                        // Must have at least one of the includeTags
                        isIncluded = allTags.some(noteTag => includeTags.includes(noteTag));
                    }
    
                    if (isIncluded) {
                        // console.log(`Including ${file.path} with tags: ${noteTags.join(', ')}`);
                        filesToSync.push(file);
                    }
                }
    
                // 4. Perform the "Sync" Action on the filtered files
                if (filesToSync.length === 0) {
                    new Notice('Sync complete. No notes matched the tag criteria.');
                    return;
                }
    
                new Notice(`Found ${filesToSync.length} notes to sync. Starting process...`);
                console.log(`Files to sync (${filesToSync.length}):`, filesToSync.map(f => f.path));
    
                // --- !! YOUR SYNC LOGIC GOES HERE !! ---
                // Iterate through filesToSync and do what you need.
                // This is just a placeholder example:
                let syncCounter = 0;
                for (const file of filesToSync) {
                    try {
                        await this.syncNoteToAnki(file);
                        syncCounter++;

                    } catch (error) {
                        console.error(`Error syncing file ${file.path}:`, error);
                        new Notice(`Error syncing file: ${file.name}. Check console.`);
                    }
                }
                // --- End of Sync Logic ---
    
                new Notice(`Sync complete. Processed ${syncCounter} notes.`);
                logWithTag(`Sync complete. Processed ${syncCounter} notes.`);
            } // End of callback
        }); // End of addCommand
    
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
            
            // 2. Prepare Anki Note Fields
            const ankiFields: { [key: string]: string } = {};
            ankiFields[this.settings.ankiGuidField] = guid;

            // 3. Extract Summary Callout
            this.settings.callouts.forEach((callout) => {
                const extractedCallout = this.extractCallout(fileContent, callout);
                if (!extractedCallout) { new Notice(`Warning: No [!${callout}] callout found in "${file.basename}".`); }
                ankiFields[callout] = extractedCallout || '';
            })

            // Map properties based on settings
            for (const obsProp in this.settings.fieldMappings) {
                const ankiField = this.settings.fieldMappings[obsProp];
                if (frontmatter[obsProp]) {
                    // Handle potential arrays (like authors, tags)
                    ankiFields[ankiField] = Array.isArray(frontmatter[obsProp])
                        ? frontmatter[obsProp].join(', ') // Join arrays with comma
                        : String(frontmatter[obsProp]); // Convert others to string
                } else {
                    ankiFields[ankiField] = ''; // Default to empty if property doesn't exist
                }
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
    extractCallout(content: string, label: string): string | null {
        const calloutRegex = new RegExp(`^> \\[!${label}\\](?:[^\r\n]*)?\r?\n((?:>.*\r?\n?)*)`, 'im');
        const match = content.match(calloutRegex);

        if (match && match[1]) {
            // Remove the leading '> ' from each line of the captured content
            const text = match[1];
            
            // Convert text to markdown
            const tempDiv = document.createElement('div');
            MarkdownRenderer.render(
                this.app,
                text,
                tempDiv,
                '/', // Or the original file path if needed for context
                this   // Pass 'this' if called from within your plugin class
            );

            const plainText = tempDiv.innerHTML;
            return plainText;
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