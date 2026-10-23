import { useEffect, useState } from 'react'

const CHARACTER_SETS = {
    lowercase: 'abcdefghijklmnopqrstuvwxyz',
    uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    numbers: '0123456789',
}
const AMBIGUOUS_CHARACTERS = /[Il1O0]/g

function getCharacterGroups(options, symbolCharacters) {
    return [
        options.includeLowercase && CHARACTER_SETS.lowercase,
        options.includeUppercase && CHARACTER_SETS.uppercase,
        options.includeNumbers && CHARACTER_SETS.numbers,
        options.includeSymbols && symbolCharacters,
    ].filter(Boolean)
        .map(characters => options.excludeAmbiguous ? characters.replace(AMBIGUOUS_CHARACTERS, '') : characters)
        .filter(Boolean)
}

function getCharacterPool(groups) {
    return groups.join('')
}

function randomIndex(maximum) {
    const limit = Math.floor(256 / maximum) * maximum
    const randomByte = new Uint8Array(1)
    let value

    do {
        globalThis.crypto.getRandomValues(randomByte)
        value = randomByte[0]
    } while (value >= limit)

    return value % maximum
}

export default function PasswordGenerator({ settings, onUse }) {
    const [isOpen, setIsOpen] = useState(false)
    const [length, setLength] = useState(settings.defaultLength)
    const [options, setOptions] = useState({
        includeLowercase: settings.includeLowercase,
        includeUppercase: settings.includeUppercase,
        includeNumbers: settings.includeNumbers,
        includeSymbols: settings.includeSymbols,
        excludeAmbiguous: settings.excludeAmbiguous,
    })
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [copied, setCopied] = useState(false)
    const characterGroups = getCharacterGroups(options, settings.symbolCharacters)
    const characterPool = getCharacterPool(characterGroups)

    useEffect(() => {
        if (!isOpen) return undefined

        function closeOnEscape(event) {
            if (event.key === 'Escape') closeGenerator()
        }

        window.addEventListener('keydown', closeOnEscape)
        return () => window.removeEventListener('keydown', closeOnEscape)
    }, [isOpen])

    function closeGenerator() {
        setIsOpen(false)
        setPassword('')
        setError('')
        setCopied(false)
    }

    function generatePassword() {
        setError('')
        setCopied(false)

        if (!characterPool) {
            setPassword('')
            setError('Select at least one character type.')
            return
        }

        if (!globalThis.crypto?.getRandomValues) {
            setPassword('')
            setError('Secure password generation is unavailable in this browser.')
            return
        }

        try {
            const generated = characterGroups.map(group => group[randomIndex(group.length)])
            while (generated.length < length) {
                generated.push(characterPool[randomIndex(characterPool.length)])
            }

            for (let index = generated.length - 1; index > 0; index -= 1) {
                const swapIndex = randomIndex(index + 1)
                const character = generated[index]
                generated[index] = generated[swapIndex]
                generated[swapIndex] = character
            }

            setPassword(generated.join(''))
        } catch {
            setPassword('')
            setError('Secure password generation failed. Please try again.')
        }
    }

    function updateOption(event) {
        const { name, checked } = event.target
        setOptions(current => ({ ...current, [name]: checked }))
        setPassword('')
        setCopied(false)
        setError('')
    }

    async function copyPassword() {
        try {
            await navigator.clipboard.writeText(password)
            setCopied(true)
        } catch {
            setError('Clipboard access failed. You can select and copy the password manually.')
        }
    }

    function usePassword() {
        if (!password) return
        onUse(password)
        closeGenerator()
    }

    return (
        <>
            <button
                className="add-btn"
                type="button"
                onClick={() => {
                    setIsOpen(true)
                    generatePassword()
                }}
            >
                <i className="ph ph-key"></i> Password Generator
            </button>

            {isOpen && (
                <div className="modal-overlay" onClick={closeGenerator}>
                    <div
                        className="modal-card password-generator-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="password-generator-title"
                        onClick={event => event.stopPropagation()}
                    >
                        <h3 id="password-generator-title"><i className="ph ph-key"></i> Password Generator</h3>

                        <div className="generator-output">
                            <output className="generator-password" aria-live="polite">
                                {password || 'Generate a password'}
                            </output>
                            <button
                                className={`copy-btn ${copied ? 'copied' : ''}`}
                                type="button"
                                onClick={copyPassword}
                                disabled={!password}
                                title="Copy generated password"
                            >
                                {copied ? 'Copied' : <><i className="ph ph-copy"></i> Copy</>}
                            </button>
                        </div>

                        {password && (
                            <p className="generator-entropy">
                                Character pool: {characterPool.length} characters
                            </p>
                        )}

                        <div className="form-group generator-length">
                            <label htmlFor="generator-length">
                                Length <output htmlFor="generator-length">{length}</output>
                            </label>
                            <input
                                id="generator-length"
                                type="range"
                                min={settings.minLength}
                                max={settings.maxLength}
                                value={length}
                                onChange={event => {
                                    setLength(Number(event.target.value))
                                    setPassword('')
                                    setCopied(false)
                                }}
                            />
                        </div>

                        <fieldset className="generator-settings">
                            <legend>Character types</legend>
                            {[
                                ['includeLowercase', 'Lowercase letters'],
                                ['includeUppercase', 'Uppercase letters'],
                                ['includeNumbers', 'Numbers'],
                                ['includeSymbols', 'Symbols'],
                            ].map(([name, label]) => (
                                <label className="generator-toggle" key={name}>
                                    <input type="checkbox" name={name} checked={options[name]} onChange={updateOption} />
                                    {label}
                                </label>
                            ))}
                            <label className="generator-toggle generator-ambiguous">
                                <input
                                    type="checkbox"
                                    name="excludeAmbiguous"
                                    checked={options.excludeAmbiguous}
                                    onChange={updateOption}
                                />
                                Exclude similar characters (I, l, 1, O, 0)
                            </label>
                        </fieldset>

                        {error && <p className="error generator-error" role="alert">{error}</p>}

                        <div className="modal-actions generator-actions">
                            <button className="btn-secondary" type="button" onClick={generatePassword}>
                                <i className="ph ph-arrows-clockwise"></i> Regenerate
                            </button>
                            <button className="btn-primary" type="button" onClick={usePassword} disabled={!password}>
                                <i className="ph ph-check"></i> Use password
                            </button>
                            <button className="btn-secondary" type="button" onClick={closeGenerator}>
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}