import { PluginSettingTab, Setting } from "obsidian";
import { AnkiRequests } from "./ankiRequests";
import { addTagInputSetting, createSettingAccessor } from "./customSettingsTab";

import AnkiSyncPlugin from "./main";

// Interface for plugin settings
export interface AnkiSyncSettings {
	ankiConnectUrl: string;
	ankiDeckName: string;
	createDeckIfNotFound: boolean;
	noteTypeName: string;
	obsidianGuidProperty: string; // Name of the property in Obsidian frontmatter
    propertyNames: string[];
    callouts: string[];
    tagsToInclude: string[];
    tagsToExclude: string[];
}

export const DEFAULT_SETTINGS: AnkiSyncSettings = {
	ankiConnectUrl: 'http://127.0.0.1:8765',
	ankiDeckName: 'Obsidian articles',
	createDeckIfNotFound: true,
	noteTypeName: 'obsidian-articles', // Matches the Anki Note Type name
	obsidianGuidProperty: 'citation key', // Matches the Obsidian property name
    propertyNames: ['title', 'authors', 'journal', 'year'],
    callouts: ['summary'],
    tagsToInclude: [],
    tagsToExclude: []
}

// --- Settings Tab ---
export class AnkiSyncSettingTab extends PluginSettingTab {
    plugin: AnkiSyncPlugin;
    requests: AnkiRequests;

    constructor(plugin: AnkiSyncPlugin, requests: AnkiRequests) {
        super(plugin.app, plugin);
        this.plugin = plugin;
        this.requests = requests;
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

                
        // MAIN SETTING GROUP FOR DECKS
        const ankiConnectionGroup = containerEl.createDiv({ cls: 'settings-group' });
        new Setting(ankiConnectionGroup)
            .setName('Anki deck name')
            .setDesc('The name of the anki deck to add notes to.')
            .addText(text => text
                .setPlaceholder('Academic Articles')
                .setValue(this.plugin.settings.ankiDeckName)
                .onChange(async (value) => {
                    this.plugin.settings.ankiDeckName = value || DEFAULT_SETTINGS.ankiDeckName;
                    await this.plugin.saveSettings();
                }));

		new Setting(ankiConnectionGroup)
            .setName('Create deck if not found')
            .setDesc('If true, will automatically create a deck if it does not exist.')
            .addToggle(text => text
				.setValue(this.plugin.settings.createDeckIfNotFound)
				.onChange(async (value) => {
					this.plugin.settings.createDeckIfNotFound = value;
					await this.plugin.saveSettings();
					}))
			.addExtraButton(button => button
				.setIcon('refresh-cw')
				.setTooltip('Attempt to find deck again.')
				.onClick(async () => {
					await this.requests.findAnkiDeck(this.plugin.settings.ankiDeckName, this.plugin.settings.createDeckIfNotFound);
				}));


        new Setting(ankiConnectionGroup)
            .setName('Anki Note Type Name')
            .setDesc('The name to use for the Anki note type, created automatically by this plugin.')
            .addText(text => text
                .setPlaceholder('Academic Article')
                .setValue(this.plugin.settings.noteTypeName)
                .onChange(async (value) => {
                    this.plugin.settings.noteTypeName = value || DEFAULT_SETTINGS.noteTypeName;
                    await this.plugin.saveSettings();
                }));
			
		new Setting(ankiConnectionGroup)
            .setName('Obsidian GUID Property Name')
            .setDesc('The name of the property in Obsidian frontmatter used to store the Anki GUID.')
            .addText(text => text
                .setPlaceholder('ankiGuid')
                .setValue(this.plugin.settings.obsidianGuidProperty)
                .onChange(async (value) => {
                    this.plugin.settings.obsidianGuidProperty = value || DEFAULT_SETTINGS.obsidianGuidProperty;
                    await this.plugin.saveSettings();
                }));
            
            new Setting(ankiConnectionGroup)
            .setName('Properties to copy')
            .setDesc('Names of properties to store as Anki fields. Do not need to retype GUID.')
            .then((setting) => { addTagInputSetting(
                setting,
                createSettingAccessor(this.plugin, 'propertyNames')  // getter to access property
            ); });

            // Create setting wrapper for callout-related settings (including tag box)
            new Setting(ankiConnectionGroup)
                .setName('Callouts to copy')
                .setDesc('Identifiers of callouts (e.g. "summary" if [!summary]) to store as Anki fields.')
                .then((setting) => { addTagInputSetting(
                    setting,
                    createSettingAccessor(this.plugin, 'callouts'),
                    (tagText: string) => `[!${tagText}]`
                ); });

            new Setting(ankiConnectionGroup)
            .setName('Tags to include')
            .setDesc('Tags which should be included when syncing via tags. Leave blank to sync only notes with a GUID property.')
            .then((setting) => { addTagInputSetting(
                setting,
                createSettingAccessor(this.plugin, 'tagsToInclude')
            ); });

            new Setting(ankiConnectionGroup)
            .setName('Tags to exclude')
            .setDesc('Tags which should be excluded when syncing notes.')
            .then((setting) => { addTagInputSetting(
                setting,
                createSettingAccessor(this.plugin, 'tagsToExclude')
            ); });

    }
}