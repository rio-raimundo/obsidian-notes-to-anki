import { MarkdownView, Plugin, TFile } from 'obsidian';
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
                    try {
                        await this.requests.checkAnkiConnect();
                        await this.requests.ensureAnkiNoteTypeModel();
                        await this.requests.findAnkiDeck(this.settings.ankiDeckName, true);
                        await this.syncNoteToAnki(file);
                    } catch (error) {
                        console.error(error);
                    }
                })();
            }
        });

        this.addCommand({
            id: 'sync-notes-by-tag',
            name: 'Sync Notes by Include/Exclude Tags',
            callback: async () => {
                try {
                    await this.requests.checkAnkiConnect();
                    await this.requests.ensureAnkiNoteTypeModel();
                    await this.requests.findAnkiDeck(this.settings.ankiDeckName, true);
                    await this.syncNotesByTags();
                } catch (error) {
                    console.error(error);
                }
            }
        });
    
    }

    // --- Core Sync Logic ---
    async syncNoteToAnki(file: TFile) {
        // Returns true if new note created, false if new note updated
        try {
            const fileContent = await this.app.vault.read(file);
            const fileCache = this.app.metadataCache.getFileCache(file);
            const frontmatter = fileCache?.frontmatter || {};
            
            // Prepare Anki Note Fields
            const guid = frontmatter[this.settings.obsidianGuidProperty];
            if (!guid) { throw new ReferenceError('GUID not found in frontmatter'); }
            const ankiFields: { [key: string]: string } = {};
            ankiFields[this.settings.obsidianGuidProperty] = guid;

            // Extract contents of callouts as .HTML and assign to fields
            this.settings.callouts.forEach((callout) => {
                const extractedCallout = this.extractCallout(fileContent, callout);
                ankiFields[callout] = extractedCallout || '';  // Blank if not found
            })

            // Assign other properties to fields
            this.settings.propertyNames.forEach((propertyName) => {
                if (frontmatter[propertyName]) {
                    // Handle potential arrays (like authors, tags)
                    ankiFields[propertyName] = Array.isArray(frontmatter[propertyName])
                        ? frontmatter[propertyName].join(', ') // Join arrays with comma
                        : String(frontmatter[propertyName]); // Convert others to string
                } else {
                    ankiFields[propertyName] = ''; // Default to empty if property doesn't exist
                }
            })

            // 4. Check if Anki Note Exists (using GUID)
            const findNotesResult = await this.requests.ankiRequest<number[]>('findNotes', {
                query: `deck:"${this.settings.ankiDeckName}" "${this.settings.obsidianGuidProperty}:${guid}"`
            });

            let ankiNoteId: number | null = null;
            if (findNotesResult && findNotesResult.length > 0) {
                ankiNoteId = findNotesResult[0];
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
                return false;
            } else {
                // Add new note
                await this.requests.ankiRequest('addNote', {
                    note: {
                        deckName: this.settings.ankiDeckName,
                        modelName: this.settings.noteTypeName,
                        fields: ankiFields,
                        tags: frontmatter.tags || [] // Add tags from frontmatter if they exist
                    }
                });
                return true;
            }

        } catch (error) {
            if (error instanceof ReferenceError) { throw error; }
            console.error('Error syncing note to Anki:', error);
            logWithTag(`Error syncing "${file.basename}" to Anki. Check console (Ctrl+Shift+I) and ensure AnkiConnect is running.`);
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
        let [createCounter, updateCounter, failCounter] = [0, 0, 0];
        for (const file of filesToSync) {
            try {
                await this.syncNoteToAnki(file) ? createCounter++ : updateCounter++;
            } catch (error) {
                if (!(error instanceof ReferenceError)) {
                    failCounter++;
                    logWithTag(`Error syncing file: ${file.name}. Check console.`);
                }
            }
        }
        const text = `Sync complete.${createCounter > 0 ? ` Created ${createCounter} notes.` : ''}${updateCounter > 0 ? ` Updated ${updateCounter} notes.` : ''}${failCounter > 0 ? ` Failed to sync ${failCounter} notes.` : ''}`;
        logWithTag(text);
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
            logWithTag(`Saved GUID ${guid} to frontmatter of "${file.path}"`);
        } catch (error) {
            logWithTag(`Failed to save GUID to frontmatter for "${file.path}". Please add it manually: ${this.settings.obsidianGuidProperty}: ${guid}`);
        }
    }
}