let apiUrl = '/api/v1'
const defaultPasswordGeneratorConfig = {
    defaultLength: 20,
    minLength: 15,
    maxLength: 64,
    includeLowercase: true,
    includeUppercase: true,
    includeNumbers: true,
    includeSymbols: true,
    excludeAmbiguous: true,
    symbolCharacters: '!@#$%^&*()-_=+[]{};:,.?',
}
let passwordGeneratorConfig = { ...defaultPasswordGeneratorConfig }

function integerInRange(value, fallback, minimum, maximum) {
    const candidate = Number.isInteger(value) ? value : fallback
    return Math.min(maximum, Math.max(minimum, candidate))
}

function loadPasswordGeneratorConfig(settings = {}) {
    if (!settings || typeof settings !== 'object') settings = {}

    const minLength = integerInRange(settings.minLength, defaultPasswordGeneratorConfig.minLength, 8, 128)
    const maxLength = integerInRange(settings.maxLength, defaultPasswordGeneratorConfig.maxLength, minLength, 128)

    passwordGeneratorConfig = {
        ...defaultPasswordGeneratorConfig,
        ...settings,
        minLength,
        maxLength,
        defaultLength: integerInRange(settings.defaultLength, defaultPasswordGeneratorConfig.defaultLength, minLength, maxLength),
    }

    for (const key of ['includeLowercase', 'includeUppercase', 'includeNumbers', 'includeSymbols', 'excludeAmbiguous']) {
        passwordGeneratorConfig[key] = typeof settings[key] === 'boolean'
            ? settings[key]
            : defaultPasswordGeneratorConfig[key]
    }

    if (typeof settings.symbolCharacters !== 'string' || !settings.symbolCharacters.length) {
        passwordGeneratorConfig.symbolCharacters = defaultPasswordGeneratorConfig.symbolCharacters
    } else {
        passwordGeneratorConfig.symbolCharacters = settings.symbolCharacters.slice(0, 128)
    }
}

export async function loadRuntimeConfig() {
    const response = await fetch(`${import.meta.env.BASE_URL}app-config.json`, {
        cache: 'no-store',
    })

    if (!response.ok) {
        throw new Error('Unable to load app-config.json.')
    }

    const config = await response.json()
    if (typeof config.apiUrl !== 'string' || !config.apiUrl.trim()) {
        throw new Error('app-config.json must contain an apiUrl string.')
    }

    apiUrl = config.apiUrl.trim().replace(/\/$/, '')
    loadPasswordGeneratorConfig(config.passwordGenerator)
}

export function getApiUrl(endpoint) {
    return `${apiUrl}${endpoint}`
}

export function getPasswordGeneratorConfig() {
    return { ...passwordGeneratorConfig }
}