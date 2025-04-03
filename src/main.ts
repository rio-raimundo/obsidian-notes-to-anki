import { MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import { AnkiSyncSettings, DEFAULT_SETTINGS, AnkiSyncSettingTab } from './settings';
import { logWithTag } from './auxilliary';
import { MarkdownRenderer } from 'obsidian'; // Use Obsidian's renderer
import { AnkiRequests } from './ankiRequests';

export default class AnkiSyncPlugin extends Plugin {
    settings: AnkiSyncSettings;
    requests: AnkiRequests;

    get includeTags() { return this.settings.tagsToInclude?.map(t => t.toLowerCase()) ?? []; }
    get excludeTags() { return this.settings.tagsToExclude?.map(t => t.toLowerCase()) ?? []; }

    async onload() {
        await this.loadSettings();
        this.requests = new AnkiRequests(this);
		this.addSettingTab(new AnkiSyncSettingTab(this, this.requests));
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
                
                // All logic goes here
                const file = markdownView.file;
                (async () => {
                    await this.requests.checkAnkiConnect(this.settings.ankiConnectUrl);
                    await this.requests.findAnkiDeck(this.settings.ankiDeckName, true);
                    await this.syncNoteToAnki(file);
                })();
            }
        });

        this.addCommand({
            id: 'sync-notes-by-tag',
            name: 'Sync Notes by Include/Exclude Tags',
            callback: () => { this.syncNotesByTags(); }
        });
    
    }

    // --- Core Sync Logic ---
    async syncNoteToAnki(file: TFile) {
        try {
            const fileContent = await this.app.vault.read(file);
            const fileCache = this.app.metadataCache.getFileCache(file);
            const frontmatter = fileCache?.frontmatter || {};

            // 1. Get unique ID
            const guid = frontmatter[this.settings.obsidianGuidProperty];
            
            // 2. Prepare Anki Note Fields
            const ankiFields: { [key: string]: string } = {};
            ankiFields[this.settings.ankiGuidField] = guid;

            // Extract contents of callouts as .HTML
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
            const findNotesResult = await this.requests.ankiRequest<number[]>('findNotes', {
                query: `deck:"${this.settings.ankiDeckName}" "${this.settings.ankiGuidField}:${guid}"`
            });

            let ankiNoteId: number | null = null;
            if (findNotesResult && findNotesResult.length > 0) {
                ankiNoteId = findNotesResult[0];
                console.log(`Found existing Anki note (ID: ${ankiNoteId}) for GUID: ${guid}`);
            }

            // 5. Add or Update Anki Note
            if (ankiNoteId !== null) {
                // Update existing note
                await this.requests.ankiRequest('updateNoteFields', {
                    note: {
                        id: ankiNoteId,
                        fields: ankiFields
                    }
                });
                new Notice(`Updated Anki note for "${file.basename}"`);
            } else {
                // Add new note
                const addNoteResult = await this.requests.ankiRequest('addNote', {
                    note: {
                        deckName: this.settings.ankiDeckName,
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

    async syncNotesByTags() {
        // Get all markdown files in the vault
        const allMarkdownFiles = this.app.vault.getMarkdownFiles();
        const filesToSync: TFile[] = [];

        // Filter files based on tags
        for (const file of allMarkdownFiles) {
            const fileTags = this.getTagsFromFile(file);

            // Skip if no tags found in the note when filtering is needed
            if (!fileTags.length && this.includeTags.length > 0) { continue; }

            // Check for exclusion criteria first
            if ( this.excludeTags.length > 0 &&
                    fileTags.some(noteTag => this.excludeTags.includes(noteTag)) )
            { continue; }

            // Check for inclusion criteria
            if (this.includeTags.length === 0 || 
                fileTags.some(noteTag => this.includeTags.includes(noteTag)))
            { filesToSync.push(file); }
        }

        // Perform the "Sync" Action on the filtered files
        if (filesToSync.length === 0) {
            logWithTag('Sync complete. No notes matched the tag criteria.');
            return;
        }

        // --- !! YOUR SYNC LOGIC GOES HERE !! ---
        let [syncCounter, failCounter] = [0, 0];
        for (const file of filesToSync) {
            try {
                await this.syncNoteToAnki(file);
                syncCounter++;
            } catch (error) {
                failCounter++;
                logWithTag(`Error syncing file: ${file.name}. Check console.`);
            }
        }
        logWithTag(`Sync complete. Processed ${syncCounter} notes. Failed to sync ${failCounter} notes.`);
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

    getTagsFromFile(file: TFile): string[] {
        // Get tags from Obsidian file. without opening '#'
        const fileCache = this.app.metadataCache.getFileCache(file);
        const noteTags = fileCache?.tags?.map(t => t.tag.substring(1).toLowerCase()) ?? [];
        const frontmatterTags = (fileCache?.frontmatter?.tags as string[])?.map(t => t.toLowerCase()) ?? [];
        return [...noteTags, ...frontmatterTags];
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