document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get('userSettings', (result) => {
        const userSettings = result.userSettings || {};
        if (userSettings.apiKey) document.getElementById('api-key').value = userSettings.apiKey;
        if (userSettings.targetLang) document.getElementById('target-lang').value = userSettings.targetLang;
        if (userSettings.sourceLang) document.getElementById('source-lang').value = userSettings.sourceLang;

        const apiType = userSettings.apiType || 'free';
        document.querySelector(`input[value="${apiType}"]`).checked = true;
    });

    document.getElementById('change-shortcut').addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });
    
    chrome.commands.getAll(commands => {
        const translateCmd = commands.find(c => c.name === 'translate-selection');
        const revertCmd = commands.find(c => c.name === 'revert-translation');
        document.getElementById('translate-shortcut').value = translateCmd?.shortcut || 'Alt+T';
        document.getElementById('revert-shortcut').value = revertCmd?.shortcut || 'Alt+R';
    });

    document.getElementById('save').addEventListener('click', () => {
        const settings = {
            apiKey: document.getElementById('api-key').value,
            apiType: document.querySelector('input[name="api-type"]:checked').value,
            sourceLang: document.getElementById('source-lang').value,
            targetLang: document.getElementById('target-lang').value
        };

        chrome.storage.local.set({ userSettings: settings }, () => {
            const status = document.getElementById('status');
            status.textContent = 'Configurações salvas!';
            setTimeout(() => status.textContent = '', 2000);
        });
    });
});