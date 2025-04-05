import { Setting, getIcon } from "obsidian";
import AnkiSyncPlugin from "./main";
import { AnkiSyncSettings } from "./settings";

// Define custom getter setter behaviour for settings, which want to read / assign from a specific settings variable
type SettingGetSet<T> = [() => T, (newValue: T) => Promise<void>];

export function createSettingAccessor<K extends keyof AnkiSyncSettings>(
    pluginInstance: AnkiSyncPlugin,
    key: K  // Generic type
): [() => AnkiSyncSettings[K], (newValue: AnkiSyncSettings[K]) => Promise<void>] {

    // Getter: Simply returns the current value of the setting property
    const getter = (): AnkiSyncSettings[K] => { return pluginInstance.settings[key]; };

    // Setter: Updates the setting property and then saves all settings
    const setter = async (updatedValue: AnkiSyncSettings[K]): Promise<void> => {
        pluginInstance.settings[key] = updatedValue;
        await pluginInstance.saveSettings();
    };
    return [getter, setter];
}

/**
 * Adds a tag input control to an existing Obsidian Setting instance.
 * Assumes CSS for '.tag-input-container', '.tag-chip', '.remove-tag-button',
 * and '.tag-input-field' is defined elsewhere (similar to previous examples).
 *
 * @param {import('obsidian').Setting} setting - The Obsidian Setting instance to modify.
 * @param {function(): string[]} getTags - Function to retrieve the current array of tag strings.
 * @param {function(string[]): void} setTags - Function to update the array of tags. Should handle saving/persistence.
 * @returns {import('obsidian').Setting} - Returns the same Setting instance for chaining.
 */
export function addTagInputSetting(
    setting: Setting,
    accessor: SettingGetSet<string[]>,
    textRenderer?: (tagText: string) => string
): Setting {
    // Extract from accessor
    const [getTags, setTags] = accessor;

    // Add tag .notes-to-anki-tags-input to the setting container
    setting.controlEl.parentElement?.classList.add('notes-to-anki-tags-input');

    // Create the main container div and input field
    const containerEl = setting.controlEl.createDiv({ cls: 'multi-select-container' });
    const inputEl = createInputField();

    // Render the initial set of tags when the setting is displayed
    const initialTags = getTags();
    initialTags.forEach(tagText => {
        addTagChip(tagText); // Use the function to add each initial tag
    });
    // Ensure input is visually last (though insertBefore handles placement correctly)
    containerEl.appendChild(inputEl);
    return setting;

    // --- Function to create and add a single tag UI element ---
    /**
     * Creates the DOM elements for a single tag and inserts it before the input field.
     * @param {string} tagText - The text content of the tag to add.
     */
    function addTagChip(tagText: string) {
        // 1. Create the outermost container div
        const outerPillDiv = document.createElement('div');
        outerPillDiv.className = 'multi-select-pill'; // Set the class
        outerPillDiv.setAttribute('tabindex', '0');  // Add tabindex for focusability like in the image

        // 2. Create the inner content wrapper div
        const contentDiv = document.createElement('div');
        contentDiv.className = 'multi-select-pill-content'; // Set its class
        contentDiv.dataset.trueValue = tagText; // Store the original value
        contentDiv.textContent = textRenderer ? textRenderer(tagText) : tagText;

        // Create the remove button
        const removeButton = document.createElement('div');
        removeButton.className = 'multi-select-pill-remove-button'
        removeButton.appendChild(getIcon('x') ?? document.createElement('span'));

        // Event listener for on click
        removeButton.addEventListener('click', (event) => {
            event.stopPropagation();
            setTags(getTags().filter(tag => tag !== tagText));
            outerPillDiv.remove();
        });

        // 4. Assemble the structure: span -> contentDiv -> outerPillDiv
        outerPillDiv.appendChild(contentDiv);
        outerPillDiv.appendChild(removeButton);

        // Insert the new tag element right before the input field
        containerEl.insertBefore(outerPillDiv, inputEl);
    }

    function createInputField() {
        const inputEl = createEditableDiv(containerEl, 'multi-select-input');

        // Create click listener on the container to focus the input when clicked
        containerEl.addEventListener('click', (event) => {
            if (event.target === containerEl) {
                inputEl.focus();
            }
        });

        // Listeners for keydown
        inputEl.addEventListener('keydown', (event) => {

            // Listener to create tag on 'enter' press
            if (event.key === 'Enter') {
                event.preventDefault(); // Prevent default 'Enter' behavior (e.g., form submission)
                const newTag = (inputEl.textContent ?? '').trim(); // Get and clean the input value

                if (newTag) { // Proceed only if the input is not empty
                    const currentTags = getTags();
                    if (!currentTags.includes(newTag)) {
                        // Add the new tag to the existing list
                        setTags([...currentTags, newTag]);
                        addTagChip(newTag);
                    }

                    // Clear the input field and focus back
                    inputEl.textContent = ''; // Clear the input field
                    inputEl.focus();
                }
            }

            // Listener to delete final tag on 'backspace' press
            else if (event.key === 'Backspace') {
                const currentTags = getTags();
                if (currentTags.length === 0 || inputEl.textContent !== '') return;
                event.preventDefault();
                
                // Remove the last tag element - first check we have the right element
                const lastTagElement = inputEl.previousElementSibling;
                if (lastTagElement && lastTagElement.classList.contains('multi-select-pill')) {
                    setTags(currentTags.slice(0, -1));
                    lastTagElement.remove();
                }
                else { console.warn("Backspace: Could not find the visual tag element to remove before the input field."); }
            }
        });

        return inputEl;
    }
}

function createEditableDiv(containerEl: HTMLElement, className = 'editable-tag-input') {
    const editableEl = containerEl.createEl('span', {
        cls: className
    });
    editableEl.contentEditable = 'true'; // Make it editable
    editableEl.role = 'textbox';
    return editableEl;
}