import { PluginSettingTab, Setting, Notice } from "obsidian";
import { AnkiRequests } from "./ankiRequests";

import AnkiSyncPlugin from "./main";

// Interface for plugin settings
export interface AnkiSyncSettings {
	ankiConnectUrl: string;
	defaultDeck: string;
	createDeckIfNotFound: boolean;
	noteTypeName: string;
	ankiGuidField: string; // Name of the GUID field in Anki Note Type
	obsidianGuidProperty: string; // Name of the property in Obsidian frontmatter
	fieldMappings: { [obsidianProperty: string]: string }; // Maps Obsidian property keys to Anki field names
    callouts: string[];
    tagsToInclude: string[];
    tagsToExclude: string[];
}

export const DEFAULT_SETTINGS: AnkiSyncSettings = {
	ankiConnectUrl: 'http://127.0.0.1:8765',
	defaultDeck: 'Obsidian articles',
	createDeckIfNotFound: true,
	noteTypeName: 'obsidian-articles', // Matches the Anki Note Type name
	ankiGuidField: 'GUID',           // Matches the Anki field name for the GUID
	obsidianGuidProperty: 'citation key', // Matches the Obsidian property name
	fieldMappings: {
		'title': 'Title', // Obsidian property 'title' maps to Anki field 'Title'
		'authors': 'Authors',
		'journal': 'Journal',
		'year': 'Year'
	},
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

        new Setting(containerEl)
            .setName('Anki deck name')
            .setDesc('The name of the anki deck to add notes to.')
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
				.onChange(async (value) => {
					this.plugin.settings.createDeckIfNotFound = value;
					await this.plugin.saveSettings();
					}))
			.addExtraButton(button => button
				.setIcon('refresh-cw')
				.setTooltip('Attempt to find deck again.')
				.onClick(async () => {
					await this.requests.findAnkiDeck(this.plugin.settings.defaultDeck, this.plugin.settings.createDeckIfNotFound);
				}));


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

        // Add more settings here for field mappings if you want them configurable via UI
        // For simplicity, the example uses hardcoded mappings in DEFAULT_SETTINGS,
        // but you could add settings to configure which Obsidian prop goes to which Anki field.
         containerEl.createEl('h3', { text: 'Field Mappings' });
         containerEl.createEl('p', { text: 'Define how Obsidian properties map to Anki fields. Format: {"obsidianProperty": "AnkiField", ...}.' });
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
            
            new Setting(containerEl)
            .setName('Callouts to copy')
            .setDesc('Add callouts to copy from Obsidian to Anki, separated by enter.')
            .then((setting) => {
                // Use controlEl for custom HTML structure
                const controlEl = setting.controlEl;
                controlEl.addClass('tag-input-container'); // For potential CSS targeting

                // Div to hold the visible tags
                const tagsDiv = controlEl.createDiv({ cls: 'tags-display' });

                // Input field for the next tag
                const inputEl = controlEl.createEl('input', { type: 'text', placeholder: 'Add option...' });
                inputEl.addClass('tag-input-field');

                // --- Helper function to render tags ---
                const renderTags = () => {
                    tagsDiv.empty(); // Clear existing tags
                    this.plugin.settings.callouts.forEach((tagText, index) => {
                        const tagEl = tagsDiv.createSpan({ cls: 'tag-item' });
                        tagEl.setText(tagText);
                        const removeBtn = tagEl.createSpan({ cls: 'tag-remove', text: '✖' }); // Simple 'x'

                        removeBtn.addEventListener('click', async () => {
                            this.plugin.settings.callouts.splice(index, 1); // Remove from array
                            await this.plugin.saveSettings();
                            renderTags(); // Re-render the tags UI
                        });
                    });
                    // Ensure input is always after tags
                    controlEl.appendChild(inputEl);
                    inputEl.focus(); // Optional: Keep focus on input
                };

                // --- Event listener for adding tags ---
                inputEl.addEventListener('keydown', async (event) => {
                    // Add tag on Enter or Comma, prevent default for these keys if adding
                    if (event.key === 'Enter') {
                        event.preventDefault(); // Prevent form submission or comma in input
                        const newTag = inputEl.value.trim();
                        inputEl.value = ''; // Clear input immediately

                        if (newTag && !this.plugin.settings.callouts.includes(newTag)) {
                            this.plugin.settings.callouts.push(newTag);
                            await this.plugin.saveSettings();
                            renderTags(); // Add the new tag visually
                        }
                    }
                });
                // Optional: Add tag on blur (losing focus)
                inputEl.addEventListener('blur', async () => {
                    // Set timeout allows click on remove button to register before blur potentially adds tag
                    setTimeout(async () => {
                        const newTag = inputEl.value.trim();
                        inputEl.value = ''; // Clear input

                        if (newTag && !this.plugin.settings.callouts.includes(newTag)) {
                            this.plugin.settings.callouts.push(newTag);
                            await this.plugin.saveSettings();
                            renderTags();
                        }
                    }, 100); // Small delay
                });

                // --- Initial rendering ---
                renderTags();
            });

            new Setting(containerEl)
            .setName('Tags to include')
            .setDesc('Tags which should be included when generating notes.')
            .then((setting) => {
                // Use controlEl for custom HTML structure
                const controlEl = setting.controlEl;
                controlEl.addClass('tag-input-container'); // For potential CSS targeting

                // Div to hold the visible tags
                const tagsDiv = controlEl.createDiv({ cls: 'tags-display' });

                // Input field for the next tag
                const inputEl = controlEl.createEl('input', { type: 'text', placeholder: 'Add option...' });
                inputEl.addClass('tag-input-field');

                // --- Helper function to render tags ---
                const renderTags = () => {
                    tagsDiv.empty(); // Clear existing tags
                    this.plugin.settings.tagsToInclude.forEach((tagText, index) => {
                        const tagEl = tagsDiv.createSpan({ cls: 'tag-item' });
                        tagEl.setText(tagText);
                        const removeBtn = tagEl.createSpan({ cls: 'tag-remove', text: '✖' }); // Simple 'x'

                        removeBtn.addEventListener('click', async () => {
                            this.plugin.settings.tagsToInclude.splice(index, 1); // Remove from array
                            await this.plugin.saveSettings();
                            renderTags(); // Re-render the tags UI
                        });
                    });
                    // Ensure input is always after tags
                    controlEl.appendChild(inputEl);
                    inputEl.focus(); // Optional: Keep focus on input
                };

                // --- Event listener for adding tags ---
                inputEl.addEventListener('keydown', async (event) => {
                    // Add tag on Enter or Comma, prevent default for these keys if adding
                    if (event.key === 'Enter') {
                        event.preventDefault(); // Prevent form submission or comma in input
                        const newTag = inputEl.value.trim();
                        inputEl.value = ''; // Clear input immediately

                        if (newTag && !this.plugin.settings.tagsToInclude.includes(newTag)) {
                            this.plugin.settings.tagsToInclude.push(newTag);
                            await this.plugin.saveSettings();
                            renderTags(); // Add the new tag visually
                        }
                    }
                });
                // Optional: Add tag on blur (losing focus)
                inputEl.addEventListener('blur', async () => {
                    // Set timeout allows click on remove button to register before blur potentially adds tag
                    setTimeout(async () => {
                        const newTag = inputEl.value.trim();
                        inputEl.value = ''; // Clear input

                        if (newTag && !this.plugin.settings.tagsToInclude.includes(newTag)) {
                            this.plugin.settings.tagsToInclude.push(newTag);
                            await this.plugin.saveSettings();
                            renderTags();
                        }
                    }, 100); // Small delay
                });

                // --- Initial rendering ---
                renderTags();
            });

            new Setting(containerEl)
            .setName('Tags to exclude')
            .setDesc('Tags which should be excluded when syncing notes.')
            .then((setting) => {
                // Use controlEl for custom HTML structure
                const controlEl = setting.controlEl;
                controlEl.addClass('tag-input-container'); // For potential CSS targeting

                // Div to hold the visible tags
                const tagsDiv = controlEl.createDiv({ cls: 'tags-display' });

                // Input field for the next tag
                const inputEl = controlEl.createEl('input', { type: 'text', placeholder: 'Add option...' });
                inputEl.addClass('tag-input-field');

                // --- Helper function to render tags ---
                const renderTags = () => {
                    tagsDiv.empty(); // Clear existing tags
                    this.plugin.settings.tagsToExclude.forEach((tagText, index) => {
                        const tagEl = tagsDiv.createSpan({ cls: 'tag-item' });
                        tagEl.setText(tagText);
                        const removeBtn = tagEl.createSpan({ cls: 'tag-remove', text: '✖' }); // Simple 'x'

                        removeBtn.addEventListener('click', async () => {
                            this.plugin.settings.tagsToExclude.splice(index, 1); // Remove from array
                            await this.plugin.saveSettings();
                            renderTags(); // Re-render the tags UI
                        });
                    });
                    // Ensure input is always after tags
                    controlEl.appendChild(inputEl);
                    inputEl.focus(); // Optional: Keep focus on input
                };

                // --- Event listener for adding tags ---
                inputEl.addEventListener('keydown', async (event) => {
                    // Add tag on Enter or Comma, prevent default for these keys if adding
                    if (event.key === 'Enter') {
                        event.preventDefault(); // Prevent form submission or comma in input
                        const newTag = inputEl.value.trim();
                        inputEl.value = ''; // Clear input immediately

                        if (newTag && !this.plugin.settings.tagsToExclude.includes(newTag)) {
                            this.plugin.settings.tagsToExclude.push(newTag);
                            await this.plugin.saveSettings();
                            renderTags(); // Add the new tag visually
                        }
                    }
                });
                // Optional: Add tag on blur (losing focus)
                inputEl.addEventListener('blur', async () => {
                    // Set timeout allows click on remove button to register before blur potentially adds tag
                    setTimeout(async () => {
                        const newTag = inputEl.value.trim();
                        inputEl.value = ''; // Clear input

                        if (newTag && !this.plugin.settings.tagsToExclude.includes(newTag)) {
                            this.plugin.settings.tagsToExclude.push(newTag);
                            await this.plugin.saveSettings();
                            renderTags();
                        }
                    }, 100); // Small delay
                });

                // --- Initial rendering ---
                renderTags();
            });

    }
}