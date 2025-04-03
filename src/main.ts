import { MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import { AnkiSyncSettings, DEFAULT_SETTINGS, AnkiSyncSettingTab } from './settings';
import { logWithTag } from './auxilliary';
import { MarkdownRenderer } from 'obsidian'; // Use Obsidian's renderer
import { AnkiRequests } from './ankiRequests';




export default class AnkiSyncPlugin extends Plugin {
    settings: AnkiSyncSettings;
    requests: AnkiRequests;

    async onload() {
        await this.loadSettings();
		this.addSettingTab(new AnkiSyncSettingTab(this.app, this));
        this.requests = new AnkiRequests(this);
        this.addAllCommands();

        // Check if anki deck exists; create if it does now
		logWithTag('Plugin loaded.');
    }
    onunload() { logWithTag('Plugin unloaded successfully.'); }

    async saveSettings() { await this.saveData(this.settings); }
    async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }

    addAllCommands() {
        // Add command to sync the current note
        this.addCommand({
            id: 'sync-current-note-to-anki',
            name: 'Sync current note to Anki',
            checkCallback: (checking: boolean) => {
                const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (!markdownView || !markdownView.file) { return false; }
                if (checking) { return true; }
                
                const file = markdownView.file;
                (async () => {
                    await this.requests.checkAnkiConnect(this.settings.ankiConnectUrl);
                    await this.requests.findAnkiDeck(this.settings.defaultDeck, true);
                    await this.syncNoteToAnki(file);
                })();
                return true;
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
            const findNotesResult = await this.requests.ankiRequest<number[]>(this.settings.ankiConnectUrl, 'findNotes', {
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
                await this.requests.ankiRequest(this.settings.ankiConnectUrl, 'updateNoteFields', {
                    note: {
                        id: ankiNoteId,
                        fields: ankiFields
                    }
                });
                new Notice(`Updated Anki note for "${file.basename}"`);
            } else {
                // Add new note
                const addNoteResult = await this.requests.ankiRequest(this.settings.ankiConnectUrl, 'addNote', {
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