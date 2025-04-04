/**
 * Creates an enhanced tag input component within a specified container element.
 *
 * @param containerEl The HTMLElement to build the tag input within (e.g., setting.controlEl).
 * @param plugin The plugin instance (used for accessing/saving settings).
 * @param settingsKey The key in `plugin.settings` that holds the array of tag strings.
 * @param placeholderText Optional placeholder text for the input field (defaults to 'Add tag...').
 */
export function createTagInputComponent(
    containerEl: HTMLElement,
    getTags: () => string[] | undefined | null,
    setTags: (newTags: string[]) => Promise<void>,
    placeholderText = 'Add tag...'
) {
    // --- Basic Structure ---
    containerEl.addClass('enhanced-tag-input-container'); // Main container class

    // Div to hold the list of tags
    const tagListEl = containerEl.createDiv({ cls: 'tag-list' });

    // Input field for adding new tags (placed logically after tags)
    const inputEl = containerEl.createEl('input', {
        type: 'text',
        placeholder: placeholderText,
    });
    inputEl.addClass('tag-add-input');

    // --- Helper function to render tags ---
    const renderTags = () => {
        tagListEl.empty(); // Clear existing tags before re-rendering

        // Ensure the setting exists and is an array
        const tags: string[] = getTags() ?? [];
        tags.forEach((tagText, index) => {
            const tagItemEl = tagListEl.createDiv({ cls: 'tag-item' });

            // Using data-attribute similar to Obsidian's properties for styling consistency
            tagItemEl.dataset.tagName = tagText; // Store the tag name if needed

            const tagInnerEl = tagItemEl.createSpan({ cls: 'tag-item-inner' });
            tagInnerEl.setText(tagText);

            const removeBtn = tagItemEl.createSpan({ cls: 'tag-remove-button' });
            removeBtn.innerHTML = '×'; // Use HTML entity for 'x'

            removeBtn.addEventListener('click', async () => {
                const currentTags = (getTags() ?? []).splice(index, 1);
                await setTags(currentTags);
                renderTags(); // Re-render the tags UI
                inputEl.focus(); // Keep focus on input after removal
            });
        });

        // Ensure input is always visually after the tags (even if containerEl structure changes)
        containerEl.appendChild(inputEl);
         // Optional: Auto-focus could be annoying if there are many settings
        // inputEl.focus();
    };

    // --- Event Listener for Adding Tags ---
    inputEl.addEventListener('keydown', async (event) => {
        if (event.key === 'Enter') {
            event.preventDefault(); // Prevent form submission if applicable
            const newTagText = inputEl.value.trim();
            await addTags(newTagText);
        }
    });

    async function addTags(newTagText: string) {
        if (newTagText) { // Only add if not empty
            const currentTags = getTags() ?? [];
            // Optional: Prevent duplicates
            if (!currentTags.includes(newTagText)) {
                await setTags([...currentTags, newTagText]);
                inputEl.value = ''; // Clear the input
                renderTags(); // Re-render
            } else {
                // Optional: Add a visual cue that the tag already exists
                inputEl.addClass('input-error');
                setTimeout(() => inputEl.removeClass('input-error'), 1000);
            }
        }
    }

    // Optional: Add tag on blur (losing focus)
    inputEl.addEventListener('blur', async () => {
        const newTagText = inputEl.value.trim();
        await addTags(newTagText);
    });

    // --- Initial Render ---
    renderTags();
}