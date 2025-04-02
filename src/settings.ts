import { PluginSettingTab, App, Setting, Notice } from "obsidian";

import AnkiSyncPlugin from "./main";

// Interface for plugin settings
export interface AnkiSyncSettings {
	ankiConnectUrl: string;
	defaultDeck: string;
	createDeckIfNotFound: boolean;
	noteTypeName: string;
	ankiGuidField: string; // Name of the GUID field in Anki Note Type
	obsidianGuidProperty: string; // Name of the property in Obsidian frontmatter
	summaryCalloutLable: string; // e.g., "summary" for [!summary]
	fieldMappings: { [obsidianProperty: string]: string }; // Maps Obsidian property keys to Anki field names
}

export const DEFAULT_SETTINGS: AnkiSyncSettings = {
	ankiConnectUrl: 'http://127.0.0.1:8765',
	defaultDeck: 'Obsidian articles',
	createDeckIfNotFound: true,
	noteTypeName: 'obsidian-articles', // Matches the Anki Note Type name
	ankiGuidField: 'GUID',           // Matches the Anki field name for the GUID
	obsidianGuidProperty: 'citation key', // Matches the Obsidian property name
	summaryCalloutLable: 'summary',
	fieldMappings: {
		'title': 'Title', // Obsidian property 'title' maps to Anki field 'Title'
		'authors': 'Authors',
		'journal': 'Journal',
		'year': 'Year',
		// Add more mappings as needed
		// Special mapping for the summary callout
		'summaryCallout': 'Back' // Map the extracted summary to the 'Back' field
	}
}

// --- Settings Tab ---
export class AnkiSyncSettingTab extends PluginSettingTab {
    plugin: AnkiSyncPlugin;

    constructor(app: App, plugin: AnkiSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Anki Sync Settings' });

        new Setting(containerEl)
            .setName('AnkiConnect URL')
            .setDesc('The URL of your AnkiConnect server.')
            .addText(text => text
                .setPlaceholder('http://127.0.0.1:8765')
                .setValue(this.plugin.settings.ankiConnectUrl)
                .onChange(async (value) => {
                    this.plugin.settings.ankiConnectUrl = value || DEFAULT_SETTINGS.ankiConnectUrl;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Default Anki Deck')
            .setDesc('The default deck to add new notes to.')
            .addText(text => text
                .setPlaceholder('Academic Articles')
                .setValue(this.plugin.settings.defaultDeck)
                .onChange(async (value) => {
                    this.plugin.settings.defaultDeck = value || DEFAULT_SETTINGS.defaultDeck;
                    await this.plugin.saveSettings();
                }));
		
		new Setting(containerEl)
            .setName('Create deck if not found')
            .setDesc('If true, will automatically create a deck if it does not exist.')
            .addToggle(text => text
				.setValue(this.plugin.settings.createDeckIfNotFound)
				.onClick()
			);

        new Setting(containerEl)
            .setName('Anki Note Type Name')
            .setDesc('The exact name of the Anki Note Type to use.')
            .addText(text => text
                .setPlaceholder('Academic Article')
                .setValue(this.plugin.settings.noteTypeName)
                .onChange(async (value) => {
                    this.plugin.settings.noteTypeName = value || DEFAULT_SETTINGS.noteTypeName;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Anki GUID Field Name')
            .setDesc('The exact name of the field in your Anki Note Type that stores the unique ID.')
            .addText(text => text
                .setPlaceholder('GUID')
                .setValue(this.plugin.settings.ankiGuidField)
                .onChange(async (value) => {
                    this.plugin.settings.ankiGuidField = value || DEFAULT_SETTINGS.ankiGuidField;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Obsidian GUID Property Name')
            .setDesc('The name of the property in Obsidian frontmatter used to store the Anki GUID.')
            .addText(text => text
                .setPlaceholder('ankiGuid')
                .setValue(this.plugin.settings.obsidianGuidProperty)
                .onChange(async (value) => {
                    this.plugin.settings.obsidianGuidProperty = value || DEFAULT_SETTINGS.obsidianGuidProperty;
                    await this.plugin.saveSettings();
                }));

       new Setting(containerEl)
            .setName('Summary Callout Label')
            .setDesc('The label used in the summary callout (e.g., "summary" for [!summary]).')
            .addText(text => text
                .setPlaceholder('summary')
                .setValue(this.plugin.settings.summaryCalloutLable)
                .onChange(async (value) => {
                    this.plugin.settings.summaryCalloutLable = value || DEFAULT_SETTINGS.summaryCalloutLable;
                    await this.plugin.saveSettings();
                }));

        // Add more settings here for field mappings if you want them configurable via UI
        // For simplicity, the example uses hardcoded mappings in DEFAULT_SETTINGS,
        // but you could add settings to configure which Obsidian prop goes to which Anki field.
         containerEl.createEl('h3', { text: 'Field Mappings' });
         containerEl.createEl('p', { text: 'Define how Obsidian properties map to Anki fields. Format: {"obsidianProperty": "AnkiField", ...}. Special key "summaryCallout" maps the summary.' });

         new Setting(containerEl)
             .setName('Mappings (JSON)')
             .setDesc('Enter mappings as a JSON object.')
             .addTextArea(text => {
                 text.setValue(JSON.stringify(this.plugin.settings.fieldMappings, null, 2))
                     .onChange(async (value) => {
                         try {
                             this.plugin.settings.fieldMappings = JSON.parse(value);
                             await this.plugin.saveSettings();
                         } catch (e) {
                             console.error("Invalid JSON for field mappings:", e);
                             new Notice("Invalid JSON format for field mappings.");
                         }
                     });
                 text.inputEl.rows = 8;
                 text.inputEl.cols = 50;
             });

    }
}